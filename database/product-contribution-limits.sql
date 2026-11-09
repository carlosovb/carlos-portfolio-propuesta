-- Aplicar después de top10-periodicity.sql e intesa-apex.sql.
begin;
alter table public.client_products add column if not exists top_pias_with_initial boolean not null default false;
alter table private.deleted_pias_payments add column if not exists top_pias_with_initial boolean not null default false;
grant insert(top_pias_with_initial), update(top_pias_with_initial) on public.client_products to authenticated;

alter table public.client_products
  drop constraint if exists client_products_payment_type_check,
  add constraint client_products_payment_type_check check (
    payment_type in ('monthly','single') or (
      payment_type in ('quarterly','annual') and not is_apex
        and regexp_replace(lower(company),'[^a-z0-9]','','g') like 'intesasanpaolo%'
        and regexp_replace(lower(product),'[^a-z0-9]','','g')in ('top10','topplan','toppias')
    )
  );

create or replace function private.pias_reserved(p_client uuid,p_year integer,p_exclude uuid default null)
returns numeric language sql stable security definer set search_path='' as $$
 with source as (
   select p.id,case when p.payment_type='single' then coalesce(p.signed_on,(p.created_at at time zone 'Atlantic/Canary')::date) else p.signed_on end signed_on,p.payment_type,p.amount,p.archived_at,p.top_pias_with_initial from public.client_products p
   where p.client_id=p_client and private.is_pias(p.company,p.product)
   union all
   select h.product_id,case when h.payment_type='single' then coalesce(h.signed_on,(h.preserved_at at time zone 'Atlantic/Canary')::date) else h.signed_on end,h.payment_type,h.amount,coalesce(h.ended_at,h.preserved_at),h.top_pias_with_initial
   from private.deleted_pias_payments h where h.client_key=p_client
 ) select coalesce(sum(amount * case payment_type when 'monthly' then 12 when 'quarterly' then 4 else 1 end
   + case when top_pias_with_initial and extract(year from signed_on)=p_year then 3000 else 0 end),0)
 from source where (p_exclude is null or id<>p_exclude) and (
   (payment_type in ('monthly','quarterly','annual') and (signed_on is null or extract(year from signed_on)<=p_year)
      and (archived_at is null or extract(year from archived_at at time zone 'Atlantic/Canary')>=p_year))
   or (payment_type='single' and extract(year from signed_on)=p_year)
 );
$$;
revoke all on function private.pias_reserved(uuid,integer,uuid) from public,anon,authenticated;

create or replace function private.guard_pias_contribution()
returns trigger language plpgsql security definer set search_path='' as $$
declare parent public.client_products; current_year integer:=extract(year from now() at time zone 'Atlantic/Canary'); y integer; first_year integer; amount_year numeric; apex_minimum numeric;
  payments integer; annual_amount numeric; product_key text; intesa boolean; axa_pias boolean;
begin
 if tg_op='UPDATE' then
   if new.is_apex<>old.is_apex or new.parent_product_id is distinct from old.parent_product_id then raise exception 'Contribution identity is immutable'; end if;
   if not new.is_apex and (new.company,new.product) is distinct from (old.company,old.product) and exists(select 1 from public.client_products where parent_product_id=old.id) then raise exception 'Cannot change the company or product of a contract with APEX'; end if;
   if (new.company,new.product,new.portfolio,new.payment_type,new.amount,new.signed_on,new.units,new.signed_multiplier,new.top_pias_with_initial)
      is not distinct from (old.company,old.product,old.portfolio,old.payment_type,old.amount,old.signed_on,old.units,old.signed_multiplier,old.top_pias_with_initial) then return new; end if;
 end if;
 perform 1 from public.portfolio_clients where id=new.client_id and owner_id=auth.uid() and deleted_at is null for update;
 if not found or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if new.is_apex then
   select * into parent from public.client_products where id=new.parent_product_id and client_id=new.client_id and not is_apex for share;
   if not found or parent.archived_at is not null then raise exception 'APEX requires an active parent contract'; end if;
   apex_minimum:=case
     when lower(trim(parent.company))='axa' and lower(trim(parent.product))='pias proyecto futuro' then 600
     when regexp_replace(lower(parent.company),'[^a-z0-9]','','g') like 'intesasanpaolo%'
       and regexp_replace(lower(parent.product),'[^a-z0-9]','','g') in ('topplan','toppremium','toppias','top10') then 300
   end;
   if apex_minimum is null then raise exception 'This product does not support APEX'; end if;
   if (new.company,new.product) is distinct from (parent.company,parent.product) or (tg_op='INSERT' and new.portfolio<>parent.portfolio) then raise exception 'APEX must belong to its parent contract'; end if;
   if new.payment_type<>'single' or new.amount<apex_minimum or new.signed_on is null or new.units is null or new.signed_multiplier is null then raise exception 'APEX requires at least % EUR, date, units and multiplier',apex_minimum; end if;
   if parent.signed_on is not null and new.signed_on<parent.signed_on then raise exception 'APEX cannot precede contract signature'; end if;
 elsif new.parent_product_id is not null then raise exception 'Invalid parent';
 end if;
 if lower(trim(new.company))='axa' and lower(trim(new.product))='pias proyecto futuro' and new.portfolio not in ('Conservadora+','Moderada+','Equilibrada+','Dinámica+','Responsable+','Global+') then raise exception 'Select a portfolio'; end if;
 payments:=case new.payment_type when 'monthly' then 12 when 'quarterly' then 4 when 'annual' then 1 end;
 annual_amount:=new.amount*coalesce(payments,1);
 intesa:=regexp_replace(lower(new.company),'[^a-z0-9]','','g') like 'intesasanpaolo%';
 product_key:=regexp_replace(lower(new.product),'[^a-z0-9]','','g');
 axa_pias:=lower(trim(new.company))='axa' and lower(trim(new.product))='pias proyecto futuro';
 if new.top_pias_with_initial and (
     new.is_apex or not intesa or product_key<>'toppias'
     or new.payment_type<>'annual' or new.amount<>50 or new.signed_on is null
   ) then raise exception 'TOP PIAS with initial premium requires an annual payment of 50 EUR and a signature date'; end if;
 if not new.is_apex then
   if tg_op='INSERT' or (new.company,new.product,new.payment_type,new.amount,new.top_pias_with_initial)
      is distinct from (old.company,old.product,old.payment_type,old.amount,old.top_pias_with_initial) then
     if intesa and product_key in ('topplan','toppias') and not new.top_pias_with_initial and (payments is null or annual_amount<600) then
       raise exception 'Intesa requires a periodic contribution of at least 600 EUR per year';
     elsif intesa and product_key='toppremium' and (new.payment_type<>'single' or new.amount<3000) then
       raise exception 'TOP Premium requires a single premium of at least 3000 EUR';
     elsif axa_pias and ((new.payment_type='monthly' and new.amount not between 50 and 666)
         or (new.payment_type='single' and new.amount<600)) then
       raise exception 'AXA PIAS requires 50 to 666 EUR monthly or at least 600 EUR as a single premium';
     end if;
   end if;
 end if;
 if not private.is_pias(new.company,new.product) then return new; end if;
 if new.signed_on is not null and (new.signed_on<date '2000-01-01' or new.signed_on>(now() at time zone 'Atlantic/Canary')::date) then raise exception 'Invalid signature date'; end if;
 if new.payment_type='single' and new.signed_on is null then raise exception 'PIAS single contribution requires a signature date'; end if;
 if new.amount<=0 then raise exception 'PIAS contributions must be positive'; end if;
 first_year:=coalesce(extract(year from new.signed_on)::integer,current_year);
 for y in first_year..case when payments is not null then greatest(current_year,first_year) else first_year end loop
   amount_year:=annual_amount + case when new.top_pias_with_initial and y=first_year then 3000 else 0 end;
   if private.pias_reserved(new.client_id,y,new.id)+amount_year>8000 then raise exception 'PIAS annual limit of 8000 EUR exceeded for %',y; end if;
 end loop;
 return new;
end; $$;
revoke all on function private.guard_pias_contribution() from public,anon,authenticated;

create or replace function private.preserve_deleted_production()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='portfolio_clients' then
   insert into private.deleted_pias_payments(product_id,client_key,signed_on,payment_type,amount,ended_at,top_pias_with_initial)
   select p.id,p.client_id,p.signed_on,p.payment_type,p.amount,p.archived_at,p.top_pias_with_initial from public.client_products p
   where p.client_id=old.id and private.is_pias(p.company,p.product) on conflict(product_id) do nothing;
 elsif private.is_pias(old.company,old.product) then
   insert into private.deleted_pias_payments(product_id,client_key,signed_on,payment_type,amount,ended_at,top_pias_with_initial)
   values(old.id,old.client_id,old.signed_on,old.payment_type,old.amount,old.archived_at,old.top_pias_with_initial) on conflict(product_id) do nothing;
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

commit;
