-- Producción por firma. No se deducen datos históricos a partir del puesto actual.
begin;
alter table public.client_products add column if not exists signed_on date;
alter table public.client_products add column if not exists signed_multiplier numeric;
alter table public.client_products add column if not exists signature_rates jsonb not null default '{}';
create index if not exists client_products_signature_date on public.client_products(signed_on) where signed_on is not null;
grant insert(signed_on,signed_multiplier,signature_rates), update(signed_on,signed_multiplier,signature_rates) on public.client_products to authenticated;

create or replace function private.validate_product_signature()
returns trigger language plpgsql security definer set search_path='' as $$
declare producer uuid; expected uuid[]; supplied uuid[]; item record;
begin
 select c.owner_id into producer from public.portfolio_clients c where c.id=new.client_id;
 if auth.uid() is null or producer<>auth.uid() or not public.team_view_allowed() then
   raise exception 'Signature not authorized' using errcode='42501';
 end if;
 if new.signed_on is null then
   new.signed_multiplier:=null; new.signature_rates:='{}'; return new;
 end if;
 if new.signed_on > (now() at time zone 'Atlantic/Canary')::date or new.signed_on<date '2000-01-01' then raise exception 'Invalid signature date'; end if;
 if new.signed_multiplier is not null and not exists(select 1 from public.team_roles where multiplier=new.signed_multiplier) then raise exception 'Invalid signature multiplier'; end if;
 if jsonb_typeof(new.signature_rates)<>'object' or pg_column_size(new.signature_rates)>32768 then raise exception 'Invalid structure'; end if;
 -- Una firma ya registrada conserva la estructura aunque después cambien los responsables.
 if tg_op='UPDATE' and old.signed_on is not null then
   select coalesce(array_agg(k::uuid order by k::uuid),'{}') into expected from jsonb_object_keys(old.signature_rates) k;
 else
   with recursive ancestors as (
     select a.manager_id user_id,array[producer] path from private.team_assignments a where a.user_id=producer and a.manager_id is not null
     union all
     select a.manager_id,b.path||b.user_id from private.team_assignments a join ancestors b on a.user_id=b.user_id where a.manager_id is not null and not a.manager_id=any(b.path||b.user_id)
   ) select coalesce(array_agg(user_id order by user_id),'{}') into expected from ancestors;
 end if;
 select coalesce(array_agg(k::uuid order by k::uuid),'{}') into supplied from jsonb_object_keys(new.signature_rates) k;
 if supplied<>expected then raise exception 'Structure changed: reopen the product editor'; end if;
 for item in select * from jsonb_each(new.signature_rates) loop
   if item.value<>'null'::jsonb and (jsonb_typeof(item.value)<>'number' or not exists(select 1 from public.team_roles where multiplier=(item.value::text)::numeric)) then raise exception 'Invalid structure multiplier'; end if;
 end loop;
 return new;
end; $$;
revoke all on function private.validate_product_signature() from public,anon,authenticated;
drop trigger if exists validate_product_signature on public.client_products;
create trigger validate_product_signature before insert or update on public.client_products for each row execute function private.validate_product_signature();

-- Fuente interna de importes por beneficiario; sin datos personales de clientes.
create or replace function private.signature_commissions()
returns table(product_id uuid,producer uuid,beneficiary uuid,signed_on date,units numeric,euros numeric,is_own boolean)
language sql stable security definer set search_path='' as $$
 select p.id,c.owner_id,c.owner_id,p.signed_on,p.units,round(p.units*p.signed_multiplier,2),true
 from public.client_products p join public.portfolio_clients c on c.id=p.client_id
 where p.signed_on<=(now() at time zone 'Atlantic/Canary')::date and p.units is not null
 union all
 select p.id,c.owner_id,k.key::uuid,p.signed_on,p.units,
 case when p.signed_multiplier is null or k.value='null'::jsonb then null
 else round(p.units*greatest((k.value::text)::numeric-p.signed_multiplier,0),2) end,false
 from public.client_products p join public.portfolio_clients c on c.id=p.client_id
 cross join lateral jsonb_each(p.signature_rates) k
 where p.signed_on<=(now() at time zone 'Atlantic/Canary')::date and p.units is not null;
$$;
revoke all on function private.signature_commissions() from public,anon,authenticated;

create or replace function public.get_unit_statistics(p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; start_day date:=date_trunc('month',p_month)::date; end_day date; today date:=(now() at time zone 'Atlantic/Canary')::date;
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_month is null or p_month<date '2000-01-01' or p_month>today then raise exception 'Invalid month'; end if;
 end_day:=(start_day+interval '1 month')::date;
 with recursive permitted as (
   select auth.uid() user_id union select a.user_id from private.team_assignments a join permitted b on a.manager_id=b.user_id
 ), source as (select * from private.signature_commissions() where signed_on>=start_day and signed_on<end_day),
 scopes as (
   select 'own' scope,s.* from source s where beneficiary=auth.uid() and is_own
   union all select 'team',s.* from source s where beneficiary=auth.uid() and not is_own
   union all select 'global',s.* from source s
 ), summary as (
   select scope,jsonb_build_object(
    'units',coalesce(sum(units) filter(where is_own or scope<>'global'),0),
    'own_units',coalesce(sum(units) filter(where is_own),0),
    'team_units',coalesce(sum(units) filter(where not is_own),0),
    'own_euros',coalesce(sum(euros) filter(where is_own),0),
    'team_euros',coalesce(sum(euros) filter(where not is_own),0),
    'pending',count(*) filter(where euros is null)) value from scopes group by scope
 ), days as (
   select scope,signed_on,jsonb_build_object('day',extract(day from signed_on),'units',coalesce(sum(units) filter(where is_own or scope<>'global'),0),'euros',coalesce(sum(euros),0),'pending',count(*) filter(where euros is null)) value
   from scopes group by scope,signed_on
 ), people as (
   select b.user_id,p.first_name||' '||p.last_name name,
    coalesce(sum(s.units) filter(where s.is_own),0) own_units,
    coalesce(sum(s.euros) filter(where s.is_own),0) own_euros,
    coalesce(sum(s.units) filter(where not s.is_own),0) team_units,
    coalesce(sum(s.euros) filter(where not s.is_own),0) team_euros,
    count(s.product_id) filter(where s.euros is null) pending
   from permitted b join public.consultant_profiles p on p.user_id=b.user_id
   left join source s on s.beneficiary=b.user_id group by b.user_id,p.first_name,p.last_name
 ) select jsonb_build_object(
   'month',start_day,'last_day',extract(day from end_day-1),
   'scopes',coalesce((select jsonb_object_agg(scope,value) from summary),'{}'::jsonb),
   'days',coalesce((select jsonb_object_agg(scope,items) from (select scope,jsonb_agg(value order by signed_on) items from days group by scope) d),'{}'::jsonb),
   'people',coalesce((select jsonb_agg(to_jsonb(p) order by name) from people p),'[]'::jsonb),
   'incomplete_team',(select count(*) from public.client_products p join public.portfolio_clients c on c.id=p.client_id where c.owner_id in(select user_id from permitted where user_id<>auth.uid()) and (p.signed_on is null or p.units is null)),
   'undated_own',(select count(*) from public.client_products p join public.portfolio_clients c on c.id=p.client_id where c.owner_id=auth.uid() and (p.signed_on is null or p.units is null)),
   'incomplete_global',(select count(*) from public.client_products where signed_on is null or units is null)
 ) into result;
 return result;
end; $$;
revoke all on function public.get_unit_statistics(date) from public,anon;
grant execute on function public.get_unit_statistics(date) to authenticated;
-- Cada consultor consulta su propio progreso y el de todos sus descendientes.
-- El árbol y las fichas profesionales conservan su visibilidad compartida.

create or replace function public.get_career_progress(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_user_id is null or not (exists(with recursive permitted as (select auth.uid() user_id union select a.user_id from private.team_assignments a join permitted p on a.manager_id=p.user_id) select 1 from permitted where user_id=p_user_id)) then raise exception 'Progress not authorized' using errcode='42501'; end if;
 if not exists(select 1 from jsonb_array_elements(public.get_team_directory()) p where (p->>'user_id')::uuid=p_user_id) then raise exception 'Profile unavailable' using errcode='42501'; end if;
 with recursive branch as (
   select a.user_id,a.position_code,array[p_user_id,a.user_id] path from private.team_assignments a where a.manager_id=p_user_id and a.user_id<>p_user_id
   union all
   select a.user_id,a.position_code,b.path||a.user_id from private.team_assignments a join branch b on a.manager_id=b.user_id where not a.user_id=any(b.path)
 ), visible as (select (p->>'user_id')::uuid user_id from jsonb_array_elements(public.get_team_directory()) p), counts as (
   select b.position_code,count(*) n from branch b join visible v on v.user_id=b.user_id where b.position_code is not null group by b.position_code
 ) select coalesce(jsonb_object_agg(position_code,n),'{}'::jsonb) into result from counts;
 return jsonb_build_object('user_id',p_user_id,'counts',result,'units_available',true,'production',(
 select jsonb_build_object(
 'quarter',coalesce(sum(s.units) filter(where s.is_own and s.signed_on>=date_trunc('quarter',now() at time zone 'Atlantic/Canary')::date),0),
 'historical',coalesce(sum(s.units) filter(where s.is_own),0),
 'totalQuarter',coalesce(sum(s.units) filter(where s.signed_on>=date_trunc('quarter',now() at time zone 'Atlantic/Canary')::date),0),
 'incomplete',(select count(*) from public.client_products p join public.portfolio_clients c on c.id=p.client_id where (c.owner_id in(with recursive family as (select p_user_id user_id union select a.user_id from private.team_assignments a join family f on a.manager_id=f.user_id) select user_id from family) or p.signature_rates ? p_user_id::text) and (p.signed_on is null or p.units is null)))
 from private.signature_commissions() s where s.beneficiary=p_user_id
 ));
end;
$$;
revoke all on function public.get_career_progress(uuid) from public,anon;
grant execute on function public.get_career_progress(uuid) to authenticated;

commit;
