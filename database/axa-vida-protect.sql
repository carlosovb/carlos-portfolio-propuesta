-- Aplicar después de product-contribution-limits.sql.
begin;
alter table public.client_products
  add column if not exists life_coverages jsonb,
  add column if not exists life_effective_on date;
grant insert(life_coverages,life_effective_on), update(life_coverages,life_effective_on)
  on public.client_products to authenticated;

alter table public.client_products
  drop constraint if exists client_products_payment_type_check,
  add constraint client_products_payment_type_check check (
    payment_type in ('monthly','single')
    or (not is_apex and (
      (payment_type in ('quarterly','annual') and regexp_replace(lower(company),'[^a-z0-9]','','g') like 'intesasanpaolo%'
        and regexp_replace(lower(product),'[^a-z0-9]','','g') in ('top10','topplan','toppias'))
      or (payment_type in ('quarterly','semiannual','annual') and lower(trim(company))='axa' and lower(trim(product))='vida protect')
    ))
  );

create or replace function private.guard_axa_life_protect()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and
    (new.company,new.product,new.portfolio,new.payment_type,new.amount,new.signed_on,new.life_coverages,new.life_effective_on)
    is not distinct from
    (old.company,old.product,old.portfolio,old.payment_type,old.amount,old.signed_on,old.life_coverages,old.life_effective_on)
  then return new; end if;
  if lower(trim(new.company))='axa' and lower(trim(new.product))='vida protect' then
    if new.is_apex or new.payment_type not in ('monthly','quarterly','semiannual','annual')
       or new.amount<=0 or new.signed_on is null or new.life_effective_on is null or new.portfolio<>'' then
      raise exception 'Vida Protect requires a periodic premium, signature date and coverage start, and no investment portfolio';
    end if;
    if new.life_coverages is null or jsonb_typeof(new.life_coverages)<>'object'
       or new.life_coverages='{}'::jsonb then
      raise exception 'Vida Protect requires at least one insured capital';
    end if;
    if new.life_coverages - array['death','death_accident','death_traffic','disability','disability_accident',
         'disability_traffic','occupational_disability','critical_illness'] <> '{}'::jsonb
       or exists (select 1 from jsonb_each(new.life_coverages) as cover(key,capital)
         where case when jsonb_typeof(capital)='number' then
           (capital::numeric not between 0.01 and 100000000 or round(capital::numeric,2)<>capital::numeric)
           else true end) then
      raise exception 'Invalid insured capital';
    end if;
  elsif new.life_coverages is not null or new.life_effective_on is not null then
    raise exception 'Life coverages are only supported for AXA Vida Protect';
  end if;
  return new;
end; $$;
revoke all on function private.guard_axa_life_protect() from public,anon,authenticated;
drop trigger if exists guard_axa_life_protect on public.client_products;
create trigger guard_axa_life_protect before insert or update on public.client_products
for each row execute function private.guard_axa_life_protect();

create or replace function private.track_product_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare item public.client_products%rowtype; owner uuid; title text; kind text;
begin
 if tg_op='DELETE' then item:=old;else item:=new;end if;
 select owner_id into owner from public.portfolio_clients where id=item.client_id;
 if owner is null then return coalesce(new,old);end if;
 if tg_op='INSERT' then title:=case when item.is_apex then 'APEX registrada' else 'Producto contratado registrado' end;kind:='product.created';
 elsif tg_op='DELETE' then title:='Producto eliminado · producción conservada';kind:='product.deleted';
 elsif to_jsonb(new) is not distinct from to_jsonb(old) then return new;
 elsif new.archived_at is distinct from old.archived_at then title:=case when new.archived_at is null then 'Producto reactivado' else 'Producto pasado al historial' end;kind:='product.archived';
 else title:='Producto actualizado';kind:='product.updated';end if;
 perform private.emit_panel_event(owner,item.client_id,kind,title,
 item.company||' · '||item.product||coalesce(' · '||nullif(item.portfolio,''),'')||' · '||item.amount::text||case item.payment_type when 'monthly' then ' €/mes' when 'quarterly' then ' €/trimestre' when 'semiannual' then ' €/semestre' when 'annual' then ' €/año' else ' € · aportación única' end||coalesce(' · '||item.units::text||' U','')||coalesce(' · Firma: '||item.signed_on::text,''),
 'client',item.client_id,case when tg_op='INSERT' then 'product-created:'||item.id::text else null end,case when tg_op='INSERT' then item.created_at else now() end);
 return coalesce(new,old);
end; $$;
revoke all on function private.track_product_event() from public,anon,authenticated;

-- Conservar las fechas de reconocimiento cuando se elimina el producto o cliente.
alter table private.deleted_product_production
  add column if not exists life_effective_on date,
  add column if not exists life_payment_type text;

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
   insert into private.deleted_product_production(product_id,producer,signed_on,units,signed_multiplier,signature_rates,life_effective_on,life_payment_type)
   select p.id,old.owner_id,p.signed_on,p.units,p.signed_multiplier,p.signature_rates,p.life_effective_on,p.payment_type from public.client_products p
   where p.client_id=old.id and p.signed_on is not null and p.units is not null on conflict(product_id) do nothing;
 else
   insert into private.deleted_product_production(product_id,producer,signed_on,units,signed_multiplier,signature_rates,life_effective_on,life_payment_type)
   select old.id,c.owner_id,old.signed_on,old.units,old.signed_multiplier,old.signature_rates,old.life_effective_on,old.payment_type from public.portfolio_clients c
   where c.id=old.client_id and old.signed_on is not null and old.units is not null on conflict(product_id) do nothing;
 end if;
 return old;
end; $$;
revoke all on function private.preserve_deleted_production() from public,anon,authenticated;

create or replace function private.signature_commissions()
returns table(product_id uuid,producer uuid,beneficiary uuid,signed_on date,units numeric,euros numeric,is_own boolean)
language sql stable security definer set search_path='' as $$
 with production as (
   select p.id,c.owner_id producer,p.signed_on,p.units,p.signed_multiplier,p.signature_rates,p.life_effective_on,p.payment_type
   from public.client_products p join public.portfolio_clients c on c.id=p.client_id
   union all
   select p.product_id,p.producer,p.signed_on,p.units,p.signed_multiplier,p.signature_rates,p.life_effective_on,p.life_payment_type
   from private.deleted_product_production p
 ), dated as (
   select p.id,p.producer,p.signed_multiplier,p.signature_rates,p.life_effective_on,
     case when p.life_effective_on is null then p.signed_on
          else (p.life_effective_on+make_interval(months=>1+instalment*12/frequency))::date end signed_on,
     case when frequency=1 then p.units
          else round(p.units*(instalment+1)/frequency,4)-round(p.units*instalment/frequency,4) end units
   from production p
   cross join lateral (select case when p.life_effective_on is not null then
     case p.payment_type when 'monthly' then 12 when 'quarterly' then 4 when 'semiannual' then 2 else 1 end
     else 1 end frequency) f
   cross join lateral generate_series(0,frequency-1) instalment
   where p.units is not null
 ), payable as (
   select p.*,coalesce(case when p.life_effective_on is null then s.segments end,jsonb_build_array(jsonb_build_object(
     'units',p.units,'multiplier',p.signed_multiplier
   ))) segments
   from dated p left join private.career_signature_splits s on s.product_id=p.id
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

create or replace function private.promote_on_signature()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 signer uuid;
 position_before text;
 needed numeric;
 recorded numeric;
 segments jsonb;
 split_text text := '';
begin
 if tg_op='UPDATE' and old.signed_on is not null and old.units is not null
    and old.signed_multiplier is not null then
   if (new.signed_on,new.units,new.signed_multiplier) is distinct from
      (old.signed_on,old.units,old.signed_multiplier)
      and exists(select 1 from private.career_signature_splits where product_id=new.id) then
     raise exception 'La producción de una firma con ascenso está consolidada.';
   end if;
   return new;
 end if;
 if new.units::text in ('NaN','Infinity','-Infinity') then raise exception 'Unidades no válidas'; end if;
 if tg_argv[0]='paused' then return new; end if;
 -- Vida Protect reconoce las unidades en las fechas de cada recibo.
 if new.life_effective_on is not null then return new; end if;
 if new.signed_on is null or coalesce(new.units,0)<=0 or new.signed_multiplier is null then return new; end if;
 select owner_id into signer from public.portfolio_clients where id=new.client_id;
 -- El bloqueo del puesto serializa las firmas simultáneas del mismo consultor.
 select position_code into position_before from private.team_assignments
 where user_id=signer for update;
 if position_before is distinct from 'financial_trainee' then return new; end if;
 -- Los tramos de la firma se calculan por su fecha. El total registrado
 -- permite actualizar el puesto sin recalcular firmas ya contabilizadas.
 select greatest(0,1000-coalesce(sum(units) filter(where signed_on<=new.signed_on),0)),
   coalesce(sum(units),0)+new.units
 into needed,recorded
 from private.signature_commissions()
 where beneficiary=signer and is_own and product_id<>new.id;
 if recorded<1000 then return new; end if;

 if new.signed_multiplier=2 and new.units>=needed then
   segments:='[]';
   if needed>0 then
     segments:=jsonb_build_array(jsonb_build_object('units',needed,'multiplier',2));
     split_text:=trim_scale(needed)::text||' U ×2';
   end if;
   if new.units>needed then
     segments:=segments||jsonb_build_array(jsonb_build_object('units',new.units-needed,'multiplier',2.5));
     split_text:=concat_ws(' + ',nullif(split_text,''),trim_scale(new.units-needed)::text||' U ×2,5');
   end if;
   insert into private.career_signature_splits(product_id,segments) values(new.id,segments);
 end if;
 update private.team_assignments set position_code='financial_consultant',updated_at=now() where user_id=signer;
 perform private.record_career_trophy(signer,new.id,'financial_consultant');
 perform private.emit_panel_event(
   signer,null,'career_promotion','¡Enhorabuena por tu ascenso!',
   'Has ascendido a Financial Consultant.'||case
     when split_text<>'' then ' Desglose de la firma: '||split_text||'.'
     when new.units<needed then ' La firma anterior y las comisiones registradas conservan sus multiplicadores.'
     else '' end,
   'career_promotion',new.id,'career-promotion:'||new.id::text,now(),true
 );
 return new;
end;
$$;
revoke all on function private.promote_on_signature() from public,anon,authenticated;
commit;
