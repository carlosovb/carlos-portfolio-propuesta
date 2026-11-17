-- Aplicar después de axa-vida-protect.sql y career-auto-promotion.sql.
begin;

create table if not exists private.life_installment_splits (
  product_id uuid not null,
  recognized_on date not null,
  segments jsonb not null check(jsonb_typeof(segments)='array'),
  primary key(product_id,recognized_on)
);
alter table private.life_installment_splits enable row level security;
revoke all on private.life_installment_splits from public,anon,authenticated;

create or replace function private.life_installments()
returns table(product_id uuid,producer uuid,recognized_on date,units numeric,signed_multiplier numeric,signature_rates jsonb)
language sql stable security definer set search_path='' as $$
  with contracts as (
    select p.id,c.owner_id,p.life_effective_on,p.payment_type,p.units,p.signed_multiplier,p.signature_rates
    from public.client_products p join public.portfolio_clients c on c.id=p.client_id
    where p.life_effective_on is not null
    union all
    select h.product_id,h.producer,h.life_effective_on,h.life_payment_type,h.units,h.signed_multiplier,h.signature_rates
    from private.deleted_product_production h where h.life_effective_on is not null
  )
  select p.id,p.owner_id,(p.life_effective_on+make_interval(months=>1+instalment*12/frequency))::date,
    case when frequency=1 then p.units
      else round(p.units*(instalment+1)/frequency,4)-round(p.units*instalment/frequency,4) end,
    p.signed_multiplier,p.signature_rates
  from contracts p
  cross join lateral (select case p.payment_type when 'monthly' then 12 when 'quarterly' then 4
    when 'semiannual' then 2 else 1 end frequency) f
  cross join lateral generate_series(0,frequency-1) instalment
  where p.units is not null;
$$;
revoke all on function private.life_installments() from public,anon,authenticated;

-- Conservar los importes de los recibos anteriores a la puesta en marcha.
insert into private.life_installment_splits(product_id,recognized_on,segments)
select i.product_id,i.recognized_on,
  jsonb_build_array(jsonb_build_object('units',i.units,'multiplier',i.signed_multiplier))
from private.life_installments() i
where i.recognized_on<(now() at time zone 'Atlantic/Canary')::date
  and i.signed_multiplier is not null
on conflict do nothing;

create or replace function private.signature_commissions()
returns table(product_id uuid,producer uuid,beneficiary uuid,signed_on date,units numeric,euros numeric,is_own boolean)
language sql stable security definer set search_path='' as $$
  with production as (
    select p.id,c.owner_id producer,p.signed_on,p.units,p.signed_multiplier,p.signature_rates,false is_life
    from public.client_products p join public.portfolio_clients c on c.id=p.client_id
    where p.life_effective_on is null
    union all
    select h.product_id,h.producer,h.signed_on,h.units,h.signed_multiplier,h.signature_rates,false
    from private.deleted_product_production h where h.life_effective_on is null
    union all
    select i.product_id,i.producer,i.recognized_on,i.units,i.signed_multiplier,i.signature_rates,true
    from private.life_installments() i
  ), payable as (
    select p.*,coalesce(
      case when p.is_life then life.segments else signature.segments end,
      jsonb_build_array(jsonb_build_object('units',p.units,'multiplier',p.signed_multiplier))
    ) segments
    from production p
    left join private.life_installment_splits life on life.product_id=p.id and life.recognized_on=p.signed_on
    left join private.career_signature_splits signature on signature.product_id=p.id
    where p.signed_on<=(now() at time zone 'Atlantic/Canary')::date and p.units is not null
  )
  select p.id,p.producer,p.producer,p.signed_on,p.units,
    (select round(sum(t.units*t.multiplier),2) from jsonb_to_recordset(p.segments) t(units numeric,multiplier numeric)),true
  from payable p
  union all
  select p.id,p.producer,k.key::uuid,p.signed_on,p.units,
    case when k.value='null'::jsonb or p.signed_multiplier is null then null else (
      select round(sum(t.units*greatest((k.value::text)::numeric-t.multiplier,0)),2)
      from jsonb_to_recordset(p.segments) t(units numeric,multiplier numeric)
    ) end,false
  from payable p cross join lateral jsonb_each(p.signature_rates) k;
$$;
revoke all on function private.signature_commissions() from public,anon,authenticated;

create or replace function private.process_due_life_promotions(p_producer uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare
  member record;
  reached record;
  instalment record;
  needed numeric;
  parts jsonb;
  detail text;
  promoted integer:=0;
  today date:=(now() at time zone 'Atlantic/Canary')::date;
begin
  for member in
    select a.user_id from private.team_assignments a
    where a.position_code='financial_trainee'
      and (p_producer is null or a.user_id=p_producer)
      and exists(select 1 from public.consultant_profiles p where p.user_id=a.user_id)
      and (exists(select 1 from private.panel_owners o where o.user_id=a.user_id)
        or exists(select 1 from private.panel_members m where m.user_id=a.user_id and m.enabled and m.password_set_at is not null))
      and exists(select 1 from private.life_installments() i
        where i.producer=a.user_id and i.recognized_on<=today and i.units>0)
      and a.user_id in (
        select producer from private.signature_commissions() where is_own
        group by producer having sum(units)>=1000
      )
    order by a.user_id
    for update of a
  loop
    select s.* into reached from (
      select product_id,signed_on,units,
        sum(units) over(order by signed_on,product_id rows unbounded preceding) running
      from private.signature_commissions() where producer=member.user_id and is_own
    ) s where s.running>=1000 order by s.signed_on,s.product_id limit 1;
    if not found then continue; end if;
    needed:=greatest(0,1000-(reached.running-reached.units));
    detail:='Has ascendido a Financial Consultant. Has alcanzado 1.000 U con las cuotas ya vencidas.';

    -- Solo la cuota que cruza el umbral y las siguientes del mismo contrato cambian de tramo.
    for instalment in select * from private.life_installments()
      where product_id=reached.product_id and recognized_on>=reached.signed_on and signed_multiplier=2
      order by recognized_on
    loop
      parts:='[]'::jsonb;
      if instalment.recognized_on=reached.signed_on and needed>0 then
        parts:=jsonb_build_array(jsonb_build_object('units',needed,'multiplier',2));
      end if;
      if instalment.units>(case when instalment.recognized_on=reached.signed_on then needed else 0 end) then
        parts:=parts||jsonb_build_array(jsonb_build_object(
          'units',instalment.units-case when instalment.recognized_on=reached.signed_on then needed else 0 end,
          'multiplier',2.5));
      end if;
      insert into private.life_installment_splits(product_id,recognized_on,segments)
        values(instalment.product_id,instalment.recognized_on,parts) on conflict do nothing;
    end loop;
    update private.team_assignments set position_code='financial_consultant',updated_at=now()
      where user_id=member.user_id and position_code='financial_trainee';
    if not found then continue; end if;
    perform private.record_career_trophy(member.user_id,reached.product_id,'financial_consultant');
    perform private.emit_panel_event(member.user_id,null,'career_promotion','¡Enhorabuena por tu ascenso!',
      detail,'career_promotion',reached.product_id,'career-promotion:'||reached.product_id::text,now(),true);
    promoted:=promoted+1;
  end loop;
  return promoted;
end; $$;
revoke all on function private.process_due_life_promotions(uuid) from public,anon,authenticated;

create or replace function private.promote_on_life_installment()
returns trigger language plpgsql security definer set search_path='' as $$
declare signer uuid;
begin
  if new.life_effective_on is not null then
    select owner_id into signer from public.portfolio_clients where id=new.client_id;
    perform private.process_due_life_promotions(signer);
  end if;
  return new;
end; $$;
revoke all on function private.promote_on_life_installment() from public,anon,authenticated;
drop trigger if exists promote_on_life_installment on public.client_products;
create trigger promote_on_life_installment after insert or update of units,signed_on,signed_multiplier,life_effective_on,payment_type
on public.client_products for each row execute function private.promote_on_life_installment();

create or replace function private.guard_life_installment_splits()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.units,new.signed_on,new.signed_multiplier,new.life_effective_on,new.payment_type)
    is distinct from (old.units,old.signed_on,old.signed_multiplier,old.life_effective_on,old.payment_type)
    and exists(select 1 from private.life_installment_splits where product_id=old.id)
  then raise exception 'La producción de los recibos ya contabilizados está consolidada.'; end if;
  return new;
end; $$;
revoke all on function private.guard_life_installment_splits() from public,anon,authenticated;
drop trigger if exists guard_life_installment_splits on public.client_products;
create trigger guard_life_installment_splits before update on public.client_products
for each row execute function private.guard_life_installment_splits();

-- Planificación en Supabase; las pruebas locales usan directamente la función.
do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('portfolio-life-promotions','* * * * *','select private.process_due_life_promotions()');
  end if;
end; $$;
commit;
