-- Bajas reversibles e historial. Las firmas y sus comisiones no se recalculan.
begin;
alter table public.portfolio_clients add column if not exists is_active boolean not null default true;
alter table public.portfolio_clients add column if not exists inactive_at timestamptz;
alter table public.client_products add column if not exists archived_at timestamptz;
create index if not exists client_products_lifecycle on public.client_products(client_id,archived_at);

create or replace function private.guard_product_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
declare active_client boolean;
begin
 select c.is_active into active_client from public.portfolio_clients c
 where c.id=new.client_id and c.owner_id=auth.uid() and c.deleted_at is null for share;
 if not found or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if not active_client and new.archived_at is null then raise exception 'Reactivate the client before adding an active product'; end if;
 return new;
end; $$;
revoke all on function private.guard_product_lifecycle() from public,anon,authenticated;
drop trigger if exists guard_product_lifecycle on public.client_products;
create trigger guard_product_lifecycle before insert or update on public.client_products
for each row execute function private.guard_product_lifecycle();

create or replace function public.set_client_active(p_client uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_active is null then raise exception 'Invalid state'; end if;
 perform 1 from public.portfolio_clients where id=p_client and owner_id=auth.uid() and deleted_at is null for update;
 if not found then raise exception 'Client unavailable' using errcode='42501'; end if;
 update public.portfolio_clients set is_active=p_active,
   inactive_at=case when p_active then null else coalesce(inactive_at,now()) end,
   status=case when p_active then 'Activo' else 'Inactivo' end
 where id=p_client and owner_id=auth.uid();
 if not p_active then
   update public.client_products set archived_at=now() where client_id=p_client and archived_at is null;
 end if;
 select jsonb_build_object('is_active',is_active,'inactive_at',inactive_at,'status',status)
 into result from public.portfolio_clients where id=p_client and owner_id=auth.uid();
 return result;
end; $$;
revoke all on function public.set_client_active(uuid,boolean) from public,anon;
grant execute on function public.set_client_active(uuid,boolean) to authenticated;

create or replace function public.set_client_product_archived(p_product uuid,p_archived boolean)
returns void language plpgsql security definer set search_path='' as $$
declare client_id_value uuid; active_client boolean;
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_archived is null then raise exception 'Invalid state'; end if;
 select p.client_id into client_id_value from public.client_products p
 join public.portfolio_clients c on c.id=p.client_id where p.id=p_product and c.owner_id=auth.uid() and c.deleted_at is null;
 select c.is_active into active_client from public.portfolio_clients c
 where c.id=client_id_value and c.owner_id=auth.uid() and deleted_at is null for update;
 if not found then raise exception 'Product unavailable' using errcode='42501'; end if;
 if not p_archived and not active_client then raise exception 'Reactivate client first'; end if;
 update public.client_products set archived_at=case when p_archived then coalesce(archived_at,now()) else null end
 where id=p_product and client_id=client_id_value;
 if not found then raise exception 'Product unavailable' using errcode='42501'; end if;
end; $$;
revoke all on function public.set_client_product_archived(uuid,boolean) from public,anon;
grant execute on function public.set_client_product_archived(uuid,boolean) to authenticated;
create or replace function public.search_my_clients(p_search text default '',p_page integer default 0,p_filters jsonb default '{}')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 result jsonb;
 term text:=left(trim(coalesce(p_search,'')),120);
 company_filter text:=nullif(trim(p_filters->>'company'),'');
 product_filter text:=nullif(trim(p_filters->>'product'),'');
 category_filter text:=nullif(p_filters->>'category','');
 activity_filter text:=nullif(p_filters->>'activity','');
 scope_filter text:=nullif(p_filters->>'product_scope','');
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
 or min_units>max_units or min_products>max_products or activity_filter not in ('active','inactive') or scope_filter not in ('current','history') then raise exception 'Invalid range'; end if;
 with base as (
   select c.*,public.client_category(c.client_type) category,
     s.companies,s.active_companies,s.products,s.product_count,s.active_product_count,s.historical_product_count,s.total_units,s.pending_units
   from public.portfolio_clients c
   cross join lateral (
     select coalesce(jsonb_agg(distinct trim(p.company)),'[]') companies,
       coalesce(jsonb_agg(distinct trim(p.company)) filter(where p.archived_at is null),'[]') active_companies,
       coalesce(jsonb_agg(distinct trim(p.product)),'[]') products,
       count(*) product_count,count(*) filter(where p.archived_at is null) active_product_count,count(*) filter(where p.archived_at is not null) historical_product_count,coalesce(sum(p.units),0) total_units,count(*) filter(where p.units is null) pending_units
     from public.client_products p where p.client_id=c.id
       and (scope_filter is null or (scope_filter='current' and p.archived_at is null) or (scope_filter='history' and p.archived_at is not null))
   ) s
 ), filtered as (
   select * from base c
   where position(substr(public.client_identity_name('',term),2) in public.client_identity_name('',c.first_name||' '||c.last_name||' '||c.locality||' '||c.email||' '||c.phone||' '||c.companies::text||' '||c.products::text))>0
     and (category_filter is null or c.category=category_filter)
     and (activity_filter is null or c.is_active=(activity_filter='active'))
     and (scope_filter is null or c.product_count>0)
     and (min_units is null or c.total_units>=min_units) and (max_units is null or c.total_units<=max_units)
     and (min_products is null or c.product_count>=min_products) and (max_products is null or c.product_count<=max_products)
     and ((company_filter is null and product_filter is null) or exists(
       select 1 from public.client_products p where p.client_id=c.id
       and (company_filter is null or lower(trim(p.company))=lower(company_filter))
       and (product_filter is null or lower(trim(p.product))=lower(product_filter))
       and (scope_filter is null or (scope_filter='current' and p.archived_at is null) or (scope_filter='history' and p.archived_at is not null))
     ))
 ), page_rows as (
   select * from filtered order by
     case when not is_active then 2 when category='client' then 0 when category='interested' then 1 else 3 end,
     case when sorting='units' then total_units end desc,
     case when sorting='products' then product_count end desc,
     case when sorting='recent' then created_at end desc,
     last_name,first_name,id limit 25 offset p_page*25
 ) select jsonb_build_object(
   'rows',coalesce((select jsonb_agg(to_jsonb(c)-'owner_id'-'identity_name') from page_rows c),'[]'),
   'total',(select count(*) from filtered),
   'stats',(select jsonb_build_object('clients',count(*) filter(where category='client' and is_active),'interested',count(*) filter(where category='interested' and is_active),'localities',count(distinct nullif(lower(trim(locality)),'')),'products',coalesce(sum(product_count),0),'units',coalesce(sum(total_units),0)) from base),
   'options',jsonb_build_object(
      'companies',coalesce((select jsonb_agg(company order by company) from (select distinct trim(company) company from public.client_products) s),'[]'),
      'products',coalesce((select jsonb_agg(jsonb_build_object('company',company,'product',product) order by company,product) from (select distinct trim(company) company,trim(product) product from public.client_products) s),'[]'))
 ) into result;
 return result;
end; $$;
revoke all on function public.search_my_clients(text,integer,jsonb) from public,anon;
grant execute on function public.search_my_clients(text,integer,jsonb) to authenticated;

create or replace function public.get_team_client_counts()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare directory jsonb; result jsonb;
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 directory:=public.get_team_directory();
 select jsonb_build_object('by_consultant',coalesce(jsonb_agg(jsonb_build_object('user_id',t.user_id,'clients',t.clients,'interested',t.interested)),'[]'::jsonb),
    'total',coalesce(sum(t.clients),0),'interested',coalesce(sum(t.interested),0),'consultants_with_clients',count(*) filter(where t.clients>0)) into result
 from (select (person->>'user_id')::uuid user_id,(select count(*) from public.portfolio_clients c where c.owner_id=(person->>'user_id')::uuid and c.is_active and c.deleted_at is null and public.client_category(c.client_type)='client') clients,
     (select count(*) from public.portfolio_clients c where c.owner_id=(person->>'user_id')::uuid and c.is_active and c.deleted_at is null and public.client_category(c.client_type)='interested') interested
   from jsonb_array_elements(directory) person) t;
 return result;
end;
$$;
revoke all on function public.get_team_client_counts() from public,anon;
grant execute on function public.get_team_client_counts() to authenticated;

commit;
