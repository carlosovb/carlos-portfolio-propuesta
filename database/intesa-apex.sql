-- APEX de Intesa. Amplía la validación existente y conserva el límite anual de PIAS.
begin;
create or replace function private.guard_pias_contribution()
returns trigger language plpgsql security definer set search_path='' as $$
declare parent public.client_products; current_year integer:=extract(year from now() at time zone 'Atlantic/Canary'); y integer; first_year integer; amount_year numeric; apex_minimum numeric;
begin
 if tg_op='UPDATE' then
   if new.is_apex<>old.is_apex or new.parent_product_id is distinct from old.parent_product_id then raise exception 'Contribution identity is immutable'; end if;
   if not new.is_apex and (new.company,new.product) is distinct from (old.company,old.product) and exists(select 1 from public.client_products where parent_product_id=old.id) then raise exception 'Cannot change the company or product of a contract with APEX'; end if;
   if (new.company,new.product,new.portfolio,new.payment_type,new.amount,new.signed_on,new.units,new.signed_multiplier)
      is not distinct from (old.company,old.product,old.portfolio,old.payment_type,old.amount,old.signed_on,old.units,old.signed_multiplier) then return new; end if;
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
commit;
