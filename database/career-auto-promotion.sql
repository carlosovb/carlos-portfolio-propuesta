-- Ascensos al registrar producción, con tramos contables conservados en el historial.
begin;
create table if not exists private.career_signature_splits (
 product_id uuid primary key, segments jsonb not null
);
alter table private.career_signature_splits enable row level security;
revoke all on private.career_signature_splits from public,anon,authenticated;

create table if not exists private.career_trophies (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null,
  position_code text not null references public.team_roles(code),
  engraved_name text not null,
  awarded_at timestamptz not null default now(),
  primary key(user_id,source_id)
);
alter table private.career_trophies enable row level security;
revoke all on private.career_trophies from public,anon,authenticated;

create or replace function private.record_career_trophy(p_user uuid,p_source uuid,p_position text)
returns void language sql security definer set search_path='' as $$
 insert into private.career_trophies(user_id,source_id,position_code,engraved_name)
 select p_user,p_source,p_position,concat_ws(' ',p.first_name,p.last_name)
 from public.consultant_profiles p where p.user_id=p_user
 on conflict(user_id,source_id) do nothing;
$$;
revoke all on function private.record_career_trophy(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.list_career_trophies(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.team_view_allowed() or not exists(
   select 1 from jsonb_array_elements(public.get_team_directory()) d where (d->>'user_id')::uuid=p_user
 ) then raise exception 'Consultor no disponible' using errcode='42501'; end if;
 return coalesce((
   select jsonb_agg(jsonb_build_object('position_code',t.position_code,'name',t.engraved_name,
     'position',r.label,'awarded_at',t.awarded_at)
     order by (t.position_code <> 'financial_trainee'),t.awarded_at)
   from (
     select position_code,engraved_name,awarded_at
     from private.career_trophies where user_id=p_user
     union all
     -- El trofeo de entrada pertenece a la vitrina y no genera un evento de ascenso.
     select 'financial_trainee',concat_ws(' ',p.first_name,p.last_name),u.created_at
     from public.consultant_profiles p join auth.users u on u.id=p.user_id
     where p.user_id=p_user and not exists (
       select 1 from private.career_trophies
       where user_id=p_user and position_code='financial_trainee'
     )
   ) t join public.team_roles r on r.code=t.position_code
 ),'[]'::jsonb);
end;
$$;
revoke all on function public.list_career_trophies(uuid) from public,anon;
grant execute on function public.list_career_trophies(uuid) to authenticated;

-- Una fila por firma y beneficiario, aunque cambie el multiplicador dentro de la firma.
create or replace function private.signature_commissions()
returns table(product_id uuid,producer uuid,beneficiary uuid,signed_on date,units numeric,euros numeric,is_own boolean)
language sql stable security definer set search_path='' as $$
 with production as (
   select p.id,c.owner_id producer,p.signed_on,p.units,p.signed_multiplier,p.signature_rates
   from public.client_products p join public.portfolio_clients c on c.id=p.client_id
   union all
   select p.product_id,p.producer,p.signed_on,p.units,p.signed_multiplier,p.signature_rates
   from private.deleted_product_production p
 ), payable as (
   select p.*,coalesce(s.segments,jsonb_build_array(jsonb_build_object(
     'units',p.units,'multiplier',p.signed_multiplier
   ))) segments
   from production p left join private.career_signature_splits s on s.product_id=p.id
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
drop trigger if exists promote_on_signature on public.client_products;
create trigger promote_on_signature after insert or update of signed_on,units,signed_multiplier
on public.client_products for each row execute function private.promote_on_signature();
commit;
