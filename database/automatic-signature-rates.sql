-- Captura automática de responsables, sin alterar las firmas históricas.
begin;
create or replace function private.validate_product_signature()
returns trigger language plpgsql security definer set search_path='' as $$
declare producer uuid;
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
 -- Los responsables y sus multiplicadores se resuelven exclusivamente en el servidor.
 if tg_op='UPDATE' and old.signed_on is not null then
   new.signature_rates:=old.signature_rates;
 else
   with recursive ancestors as (
     select a.manager_id user_id,array[producer] path from private.team_assignments a where a.user_id=producer and a.manager_id is not null
     union all
     select a.manager_id,b.path||b.user_id from private.team_assignments a join ancestors b on a.user_id=b.user_id where a.manager_id is not null and not a.manager_id=any(b.path||b.user_id)
   ) select coalesce(jsonb_object_agg(b.user_id::text,r.multiplier),'{}'::jsonb) into new.signature_rates
     from ancestors b join private.team_assignments a on a.user_id=b.user_id left join public.team_roles r on r.code=a.position_code;
 end if;
 return new;
end; $$;
revoke all on function private.validate_product_signature() from public,anon,authenticated;

commit;
