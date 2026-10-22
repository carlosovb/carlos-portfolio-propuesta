-- Cartera filtrada antes de paginar y preferencia privada por consultor.
begin;
create table if not exists private.client_view_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 view_mode text not null check(view_mode in ('list','cards','compact')),
 updated_at timestamptz not null default now()
);
alter table private.client_view_preferences enable row level security;
revoke all on private.client_view_preferences from public,anon,authenticated;

create or replace function public.get_client_view_preference()
returns text language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 return coalesce((select view_mode from private.client_view_preferences where user_id=auth.uid()),'list');
end; $$;
revoke all on function public.get_client_view_preference() from public,anon;
grant execute on function public.get_client_view_preference() to authenticated;

create or replace function public.save_client_view_preference(p_view text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_view is null or p_view not in ('list','cards','compact') then raise exception 'Invalid view'; end if;
 insert into private.client_view_preferences(user_id,view_mode) values(auth.uid(),p_view)
 on conflict(user_id) do update set view_mode=excluded.view_mode,updated_at=now();
end; $$;
revoke all on function public.save_client_view_preference(text) from public,anon;
grant execute on function public.save_client_view_preference(text) to authenticated;

create or replace function public.search_my_clients(p_search text default '',p_page integer default 0,p_filters jsonb default '{}')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 result jsonb;
 term text:=left(trim(coalesce(p_search,'')),120);
 company_filter text:=nullif(trim(p_filters->>'company'),'');
 product_filter text:=nullif(trim(p_filters->>'product'),'');
 category_filter text:=nullif(p_filters->>'category','');
 min_units numeric:=(p_filters->>'min_units')::numeric;
 max_units numeric:=(p_filters->>'max_units')::numeric;
 min_products integer:=(p_filters->>'min_products')::integer;
 max_products integer:=(p_filters->>'max_products')::integer;
 sorting text:=coalesce(p_filters->>'sort','name');
begin
 if not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>100000 or p_filters is null or jsonb_typeof(p_filters)<>'object' or pg_column_size(p_filters)>4096 then raise exception 'Invalid filters'; end if;
 if length(company_filter)>120 or length(product_filter)>160 or category_filter not in ('client','interested','other') or sorting not in ('name','units','products','recent')
 or min_units<0 or max_units<0 or min_units>1000000000000 or max_units>1000000000000
 or min_products<0 or max_products<0 or min_products>100000 or max_products>100000
 or min_units>max_units or min_products>max_products then raise exception 'Invalid range'; end if;
 with base as (
   select c.*,public.client_category(c.client_type) category,
     s.companies,s.products,s.product_count,s.total_units,s.pending_units
   from public.portfolio_clients c
   cross join lateral (
     select coalesce(jsonb_agg(distinct trim(p.company)),'[]') companies,
       coalesce(jsonb_agg(distinct trim(p.product)),'[]') products,
       count(*) product_count,coalesce(sum(p.units),0) total_units,count(*) filter(where p.units is null) pending_units
     from public.client_products p where p.client_id=c.id
   ) s
 ), filtered as (
   select * from base c
   where position(substr(public.client_identity_name('',term),2) in public.client_identity_name('',c.first_name||' '||c.last_name||' '||c.locality||' '||c.email||' '||c.phone||' '||c.companies::text||' '||c.products::text))>0
     and (category_filter is null or c.category=category_filter)
     and (min_units is null or c.total_units>=min_units) and (max_units is null or c.total_units<=max_units)
     and (min_products is null or c.product_count>=min_products) and (max_products is null or c.product_count<=max_products)
     and ((company_filter is null and product_filter is null) or exists(
       select 1 from public.client_products p where p.client_id=c.id
       and (company_filter is null or lower(trim(p.company))=lower(company_filter))
       and (product_filter is null or lower(trim(p.product))=lower(product_filter))
     ))
 ), page_rows as (
   select * from filtered order by
     case category when 'client' then 0 when 'interested' then 1 else 2 end,
     case when sorting='units' then total_units end desc,
     case when sorting='products' then product_count end desc,
     case when sorting='recent' then created_at end desc,
     last_name,first_name,id limit 25 offset p_page*25
 ) select jsonb_build_object(
   'rows',coalesce((select jsonb_agg(to_jsonb(c)-'owner_id'-'identity_name') from page_rows c),'[]'),
   'total',(select count(*) from filtered),
   'stats',(select jsonb_build_object('clients',count(*) filter(where category='client'),'interested',count(*) filter(where category='interested'),'localities',count(distinct nullif(lower(trim(locality)),'')),'products',coalesce(sum(product_count),0),'units',coalesce(sum(total_units),0)) from base),
   'options',jsonb_build_object(
      'companies',coalesce((select jsonb_agg(company order by company) from (select distinct trim(company) company from public.client_products) s),'[]'),
      'products',coalesce((select jsonb_agg(jsonb_build_object('company',company,'product',product) order by company,product) from (select distinct trim(company) company,trim(product) product from public.client_products) s),'[]'))
 ) into result;
 return result;
end; $$;
revoke all on function public.search_my_clients(text,integer,jsonb) from public,anon;
grant execute on function public.search_my_clients(text,integer,jsonb) to authenticated;
commit;
