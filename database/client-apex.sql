-- APEX: firma independiente vinculada al PIAS. Aplicar después de client-lifecycle.sql.
begin;
alter table public.client_products add column if not exists is_apex boolean not null default false;
alter table public.client_products add column if not exists parent_product_id uuid references public.client_products(id) on delete cascade;
create index if not exists client_products_parent on public.client_products(parent_product_id) where parent_product_id is not null;
grant insert(is_apex,parent_product_id) on public.client_products to authenticated;
create table if not exists private.deleted_pias_payments (
 product_id uuid primary key, client_key uuid not null, signed_on date,
 payment_type text not null, amount numeric not null, ended_at timestamptz,
 preserved_at timestamptz not null default now()
);
alter table private.deleted_pias_payments enable row level security;
revoke all on private.deleted_pias_payments from public,anon,authenticated;
create index if not exists deleted_pias_payments_client on private.deleted_pias_payments(client_key);

create or replace function private.is_pias(p_company text,p_product text)
returns boolean language sql immutable set search_path='' as $$ select lower(coalesce(p_product,'')) like '%pias%'; $$;
revoke all on function private.is_pias(text,text) from public,anon,authenticated;

-- Fuente agregada: conserva el consumo anual incluso si se elimina un producto.
create or replace function private.pias_reserved(p_client uuid,p_year integer,p_exclude uuid default null)
returns numeric language sql stable security definer set search_path='' as $$
 with source as (
   select p.id,case when p.payment_type='single' then coalesce(p.signed_on,(p.created_at at time zone 'Atlantic/Canary')::date) else p.signed_on end signed_on,p.payment_type,p.amount,p.archived_at from public.client_products p
   where p.client_id=p_client and private.is_pias(p.company,p.product)
   union all
   select h.product_id,case when h.payment_type='single' then coalesce(h.signed_on,(h.preserved_at at time zone 'Atlantic/Canary')::date) else h.signed_on end,h.payment_type,h.amount,coalesce(h.ended_at,h.preserved_at)
   from private.deleted_pias_payments h where h.client_key=p_client
 ) select coalesce(sum(case when payment_type='monthly' then amount*12 else amount end),0)
 from source where (p_exclude is null or id<>p_exclude) and (
   (payment_type='monthly' and (signed_on is null or extract(year from signed_on)<=p_year)
      and (archived_at is null or extract(year from archived_at at time zone 'Atlantic/Canary')>=p_year))
   or (payment_type='single' and extract(year from signed_on)=p_year)
 );
$$;
revoke all on function private.pias_reserved(uuid,integer,uuid) from public,anon,authenticated;

create or replace function public.get_client_pias_budget(p_client uuid,p_year integer,p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare reserved numeric;
begin
 if auth.uid() is null or not public.team_view_allowed() or not exists(select 1 from public.portfolio_clients where id=p_client and owner_id=auth.uid() and deleted_at is null) then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_year is null or p_year not between 2000 and extract(year from now() at time zone 'Atlantic/Canary')::integer+1 then raise exception 'Invalid year'; end if;
 reserved:=private.pias_reserved(p_client,p_year,p_exclude);
 return jsonb_build_object('year',p_year,'reserved',reserved,'remaining',greatest(8000-reserved,0),'limit',8000);
end; $$;
revoke all on function public.get_client_pias_budget(uuid,integer,uuid) from public,anon;
grant execute on function public.get_client_pias_budget(uuid,integer,uuid) to authenticated;

create or replace function private.guard_pias_contribution()
returns trigger language plpgsql security definer set search_path='' as $$
declare parent public.client_products; current_year integer:=extract(year from now() at time zone 'Atlantic/Canary'); y integer; first_year integer; amount_year numeric;
begin
 if tg_op='UPDATE' then
   if new.is_apex<>old.is_apex or new.parent_product_id is distinct from old.parent_product_id then raise exception 'Contribution identity is immutable'; end if;
   if not new.is_apex and (new.company,new.product) is distinct from (old.company,old.product) and exists(select 1 from public.client_products where parent_product_id=old.id) then raise exception 'Cannot change the company or product of a PIAS with APEX'; end if;
   if (new.company,new.product,new.portfolio,new.payment_type,new.amount,new.signed_on,new.units,new.signed_multiplier)
      is not distinct from (old.company,old.product,old.portfolio,old.payment_type,old.amount,old.signed_on,old.units,old.signed_multiplier) then return new; end if;
 end if;
 perform 1 from public.portfolio_clients where id=new.client_id and owner_id=auth.uid() and deleted_at is null for update;
 if not found or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if new.is_apex then
   select * into parent from public.client_products where id=new.parent_product_id and client_id=new.client_id and not is_apex for share;
   if not found or parent.archived_at is not null or lower(trim(parent.company))<>'axa' or lower(trim(parent.product))<>'pias proyecto futuro' then raise exception 'APEX requires an active AXA PIAS'; end if;
   if (new.company,new.product) is distinct from (parent.company,parent.product) or (tg_op='INSERT' and new.portfolio<>parent.portfolio) then raise exception 'APEX must belong to its PIAS'; end if;
   if new.payment_type<>'single' or new.amount<600 or new.signed_on is null or new.units is null or new.signed_multiplier is null then raise exception 'APEX requires 600 EUR, date, units and multiplier'; end if;
   if parent.signed_on is not null and new.signed_on<parent.signed_on then raise exception 'APEX cannot precede contract signature'; end if;
 elsif new.parent_product_id is not null then raise exception 'Invalid parent';
 end if;
 if lower(trim(new.company))='axa' and lower(trim(new.product))='pias proyecto futuro' and new.portfolio not in ('Conservadora+','Moderada+','Equilibrada+','Dinámica+','Responsable+','Global+') then raise exception 'Select a portfolio'; end if;
 if not private.is_pias(new.company,new.product) then return new; end if;
 if new.signed_on is not null and (new.signed_on<date '2000-01-01' or new.signed_on>(now() at time zone 'Atlantic/Canary')::date) then raise exception 'Invalid signature date'; end if;
 if new.payment_type='single' and new.signed_on is null then raise exception 'PIAS single contribution requires a signature date'; end if;
 if new.amount<=0 or (new.payment_type='monthly' and new.amount>666) then raise exception 'PIAS monthly amount must be between 0.01 and 666 EUR'; end if;
 first_year:=coalesce(extract(year from new.signed_on)::integer,current_year);
 for y in first_year..case when new.payment_type='monthly' then greatest(current_year,first_year) else first_year end loop
   amount_year:=case when new.payment_type='monthly' then new.amount*12 else new.amount end;
   if private.pias_reserved(new.client_id,y,new.id)+amount_year>8000 then raise exception 'PIAS annual limit of 8000 EUR exceeded for %',y; end if;
 end loop;
 return new;
end; $$;
revoke all on function private.guard_pias_contribution() from public,anon,authenticated;
drop trigger if exists guard_pias_contribution on public.client_products;
create trigger guard_pias_contribution before insert or update on public.client_products for each row execute function private.guard_pias_contribution();

create or replace function private.preserve_deleted_production()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='portfolio_clients' then
   insert into private.deleted_pias_payments(product_id,client_key,signed_on,payment_type,amount,ended_at)
   select p.id,p.client_id,p.signed_on,p.payment_type,p.amount,p.archived_at from public.client_products p
   where p.client_id=old.id and private.is_pias(p.company,p.product) on conflict(product_id) do nothing;
 elsif private.is_pias(old.company,old.product) then
   insert into private.deleted_pias_payments(product_id,client_key,signed_on,payment_type,amount,ended_at)
   values(old.id,old.client_id,old.signed_on,old.payment_type,old.amount,old.archived_at) on conflict(product_id) do nothing;
 end if;
 if tg_table_name='portfolio_clients' then
   insert into private.deleted_product_production(product_id,producer,signed_on,units,signed_multiplier,signature_rates)
   select p.id,old.owner_id,p.signed_on,p.units,p.signed_multiplier,p.signature_rates from public.client_products p
   where p.client_id=old.id and p.signed_on is not null and p.units is not null on conflict(product_id) do nothing;
 else
   insert into private.deleted_product_production(product_id,producer,signed_on,units,signed_multiplier,signature_rates)
   select old.id,c.owner_id,old.signed_on,old.units,old.signed_multiplier,old.signature_rates from public.portfolio_clients c
   where c.id=old.client_id and old.signed_on is not null and old.units is not null on conflict(product_id) do nothing;
 end if;
 return old;
end; $$;
revoke all on function private.preserve_deleted_production() from public,anon,authenticated;

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
       count(*) filter(where not p.is_apex) product_count,count(*) filter(where not p.is_apex and p.archived_at is null) active_product_count,count(*) filter(where not p.is_apex and p.archived_at is not null) historical_product_count,coalesce(sum(p.units),0) total_units,count(*) filter(where p.units is null) pending_units
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


commit;
