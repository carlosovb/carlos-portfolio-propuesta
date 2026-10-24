-- v0.6: historial privado, actividad, avisos y búsqueda. Sin acceso directo a registros internos.
begin;
create table if not exists private.panel_events (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 client_id uuid, kind text not null, title text not null, detail text not null default '',
 target_type text not null, target_id uuid, actor_id uuid references auth.users(id) on delete set null,
 happened_at timestamptz not null default now(), source_key text,
 unique(owner_id,source_key)
);
create index if not exists panel_events_owner_date on private.panel_events(owner_id,happened_at desc,id);
create index if not exists panel_events_actor on private.panel_events(actor_id);
create index if not exists panel_events_client_date on private.panel_events(owner_id,client_id,happened_at desc,id);
alter table private.panel_events enable row level security;
revoke all on private.panel_events from public,anon,authenticated;
create table if not exists private.panel_notifications (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references private.panel_events(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade, read_at timestamptz,
 unique(recipient_id,event_id)
);
create index if not exists panel_notifications_event on private.panel_notifications(event_id);
create index if not exists panel_notifications_recipient on private.panel_notifications(recipient_id,read_at,event_id);
alter table private.panel_notifications enable row level security;
revoke all on private.panel_notifications from public,anon,authenticated;
create or replace function private.emit_panel_event(p_owner uuid,p_client uuid,p_kind text,p_title text,p_detail text,p_type text,p_target uuid,p_key text default null,p_time timestamptz default now(),p_notify boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare event_id uuid;
begin
 insert into private.panel_events(owner_id,client_id,kind,title,detail,target_type,target_id,actor_id,source_key,happened_at)
 values(p_owner,p_client,p_kind,p_title,left(coalesce(p_detail,''),2500),p_type,p_target,auth.uid(),p_key,p_time)
 on conflict(owner_id,source_key) do nothing returning id into event_id;
 if p_notify and event_id is not null then
  insert into private.panel_notifications(event_id,recipient_id) values(event_id,p_owner);
 end if;
 return event_id;
end; $$;
revoke all on function private.emit_panel_event(uuid,uuid,text,text,text,text,uuid,text,timestamptz,boolean) from public,anon,authenticated;
create or replace function private.track_client_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare title text; kind text;
begin
 if tg_op='DELETE' then
  -- No conservar notas ni datos personales al borrar definitivamente un cliente.
  delete from private.panel_events e where e.owner_id=old.owner_id and e.client_id=old.id and e.kind='note.added';
  perform private.emit_panel_event(old.owner_id,old.id,'client.deleted','Cliente eliminado definitivamente','','client',old.id);
  return old;
 end if;
 if tg_op='INSERT' then
  perform private.emit_panel_event(new.owner_id,new.id,'client.created','Contacto incorporado a tu cartera',new.client_type,'client',new.id,'client-created:'||new.id::text,new.created_at);
  return new;
 end if;
 if new.deleted_at is distinct from old.deleted_at then
  title:=case when new.deleted_at is null then 'Cliente recuperado' else 'Cliente enviado a Eliminados' end;kind:='client.trash';
 elsif new.is_active is distinct from old.is_active then
  title:=case when new.is_active then 'Cliente reactivado' else 'Cliente dado de baja' end;kind:='client.status';
 elsif (to_jsonb(new)-array['deleted_at','is_active','inactive_at']) is distinct from (to_jsonb(old)-array['deleted_at','is_active','inactive_at']) then
  title:='Datos del cliente actualizados';kind:='client.updated';
 else return new;end if;
 perform private.emit_panel_event(new.owner_id,new.id,kind,title,'','client',new.id);
 return new;
end; $$;
revoke all on function private.track_client_event() from public,anon,authenticated;
drop trigger if exists panel_track_client on public.portfolio_clients;
create trigger panel_track_client after insert or update or delete on public.portfolio_clients for each row execute function private.track_client_event();
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
 item.company||' · '||item.product||' · '||item.portfolio||' · '||item.amount::text||case when item.payment_type='monthly' then ' €/mes' else ' € · aportación única' end||coalesce(' · '||item.units::text||' U','')||coalesce(' · Firma: '||item.signed_on::text,''),
 'client',item.client_id,case when tg_op='INSERT' then 'product-created:'||item.id::text else null end,case when tg_op='INSERT' then item.created_at else now() end);
 return coalesce(new,old);
end; $$;
revoke all on function private.track_product_event() from public,anon,authenticated;
drop trigger if exists panel_track_product on public.client_products;
create trigger panel_track_product after insert or update or delete on public.client_products for each row execute function private.track_product_event();
create or replace function private.track_form_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.emit_panel_event(new.owner_id,null,'form.received','Nuevo formulario previo recibido','Ya puedes preparar la próxima reunión.','form',new.id,'form:'||new.id::text,new.created_at,true);
 return new;
end; $$;
revoke all on function private.track_form_event() from public,anon,authenticated;
drop trigger if exists panel_track_form on public.premeeting_responses;
create trigger panel_track_form after insert on public.premeeting_responses for each row execute function private.track_form_event();
create or replace function private.track_resource_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
 if new.archived then return new;end if;
 if tg_op='UPDATE' then if not old.archived then return new;end if;end if;
 for recipient in select p.user_id from public.consultant_profiles p where
 exists(select 1 from private.panel_owners where user_id=p.user_id) or exists(select 1 from private.panel_members where user_id=p.user_id and enabled and password_set_at is not null) loop
  perform private.emit_panel_event(recipient,null,'resource.added','Nuevo recurso disponible',new.company||' · '||new.product||' · '||new.title,'resource',new.id,null,now(),recipient is distinct from auth.uid());
 end loop;return new;
end; $$;
revoke all on function private.track_resource_event() from public,anon,authenticated;
drop trigger if exists panel_track_resource on public.team_resources;
create trigger panel_track_resource after insert or update of archived on public.team_resources for each row execute function private.track_resource_event();
create or replace function private.track_invitation_completion()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; inviter uuid;
begin
 target:=new.user_id;
 if exists(select 1 from public.consultant_profiles where user_id=target) and exists(select 1 from private.panel_members where user_id=target and enabled and password_set_at is not null) then
  select inviter_id into inviter from private.consultant_invitations where user_id=target;
  if inviter is not null then perform private.emit_panel_event(inviter,null,'team.joined','Tu invitación se ha completado','Un nuevo consultor se ha incorporado a tu equipo.','team',target,'joined:'||target::text,now(),true);end if;
 end if;return new;
end; $$;
revoke all on function private.track_invitation_completion() from public,anon,authenticated;
drop trigger if exists panel_track_join_profile on public.consultant_profiles;
create trigger panel_track_join_profile after insert on public.consultant_profiles for each row execute function private.track_invitation_completion();
drop trigger if exists panel_track_join_member on private.panel_members;
create trigger panel_track_join_member after update of password_set_at on private.panel_members for each row execute function private.track_invitation_completion();
create or replace function private.panel_target_available(p_type text,p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select case p_type
 when 'form' then exists(select 1 from public.premeeting_responses where id=p_id and owner_id=auth.uid() and expires_at>now())
 when 'resource' then exists(select 1 from public.team_resources where id=p_id and not archived)
 when 'team' then exists(select 1 from public.consultant_profiles p where p.user_id=p_id and (exists(select 1 from private.panel_owners where user_id=p_id) or exists(select 1 from private.panel_members where user_id=p_id and enabled and password_set_at is not null)))
 else true end;
$$;
revoke all on function private.panel_target_available(text,uuid) from public,anon,authenticated;
create or replace function public.get_panel_activity(p_client uuid default null,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501';end if;
 if p_client is not null and not exists(select 1 from public.portfolio_clients where id=p_client and owner_id=auth.uid()) then raise exception 'Client unavailable' using errcode='42501';end if;
 return jsonb_build_object('total',(select count(*) from private.panel_events e where owner_id=auth.uid() and (p_client is null or client_id=p_client)),
 'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.happened_at desc,r.id) from (
 select e.id,e.kind,e.title,e.detail,e.target_type,e.target_id,e.happened_at,
 case when e.target_type='client' then c.id is not null and c.deleted_at is null else private.panel_target_available(e.target_type,e.target_id) end as target_available,
 nullif(trim(p.first_name||' '||p.last_name),'') as actor_name,
 nullif(trim(c.first_name||' '||c.last_name),'') as client_name
 from private.panel_events e left join public.consultant_profiles p on p.user_id=e.actor_id
 left join public.portfolio_clients c on c.id=e.client_id and c.owner_id=auth.uid()
 where e.owner_id=auth.uid() and (p_client is null or e.client_id=p_client)
 order by e.happened_at desc,e.id limit 25 offset greatest(0,least(coalesce(p_offset,0),100000))
 ) r),'[]'::jsonb));
end; $$;
create or replace function public.add_client_note(p_client uuid,p_text text,p_request uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501';end if;
 if p_request is null or p_text is null or length(trim(p_text)) not between 1 and 2000 then raise exception 'Invalid note';end if;
 perform 1 from public.portfolio_clients where id=p_client and owner_id=auth.uid() and deleted_at is null for update;
 if not found then raise exception 'Client unavailable' using errcode='42501';end if;
 perform private.emit_panel_event(auth.uid(),p_client,'note.added','Nota interna',trim(p_text),'client',p_client,'note:'||p_client::text||':'||p_request::text);
 return true;
end; $$;
create or replace function public.get_my_client(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501';end if;
 return (select to_jsonb(c) from public.portfolio_clients c where c.id=p_id and c.owner_id=auth.uid() and c.deleted_at is null);
end; $$;
create or replace function public.get_panel_target(p_type text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501';end if;
 if p_type='form' then return (select to_jsonb(f) from public.premeeting_responses f where id=p_id and owner_id=auth.uid() and expires_at>now());end if;
 if p_type='resource' then return (select to_jsonb(r) from public.team_resources r where id=p_id and not archived);end if;
 return null;
end; $$;
revoke all on function public.get_panel_target(text,uuid) from public,anon;
grant execute on function public.get_panel_target(text,uuid) to authenticated;
create or replace function public.get_panel_notifications(p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501';end if;
 return jsonb_build_object('unread',(select count(*) from private.panel_notifications n join private.panel_events e on e.id=n.event_id and e.owner_id=auth.uid() where recipient_id=auth.uid() and read_at is null and private.panel_target_available(e.target_type,e.target_id)),
 'rows',coalesce((select jsonb_agg(to_jsonb(r) order by (r.read_at is null) desc,r.happened_at desc,r.id) from (
 select n.id,n.read_at,e.title,e.detail,e.target_type,e.target_id,e.happened_at
 from private.panel_notifications n join private.panel_events e on e.id=n.event_id and e.owner_id=auth.uid()
 where recipient_id=auth.uid() and private.panel_target_available(e.target_type,e.target_id)
 order by (n.read_at is null) desc,e.happened_at desc,n.id limit 25 offset greatest(0,least(coalesce(p_offset,0),100000))
 )r),'[]'::jsonb));
end; $$;
create or replace function public.read_panel_notification(p_id uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501';end if;
 update private.panel_notifications set read_at=now() where recipient_id=auth.uid() and read_at is null and (p_id is null or id=p_id);
 return found;
end; $$;
create or replace function private.panel_search_text(p_text text)
returns text language sql immutable set search_path='' as $$ select lower(translate(coalesce(p_text,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')); $$;
revoke all on function private.panel_search_text(text) from public,anon,authenticated;
create or replace function public.search_panel(p_query text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q text:=private.panel_search_text(trim(p_query));
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501';end if;
 if q is null or length(q)<2 then return '{}'::jsonb;end if;
 if length(q)>120 then raise exception 'Query too long';end if;
 return jsonb_build_object(
 'clients',coalesce((select jsonb_agg(to_jsonb(r)) from (select c.id,trim(c.first_name||' '||c.last_name) label,c.client_type||' · '||c.locality meta
 from public.portfolio_clients c where owner_id=auth.uid() and deleted_at is null and (position(q in private.panel_search_text(c.first_name||' '||c.last_name||' '||c.phone||' '||c.email))>0
 or exists(select 1 from public.client_products p where p.client_id=c.id and position(q in private.panel_search_text(p.company||' '||p.product||' '||p.portfolio))>0)) order by c.last_name,c.first_name,c.id limit 12) r),'[]'::jsonb),
 'consultants',coalesce((select jsonb_agg(to_jsonb(r)) from (select p.user_id id,trim(p.first_name||' '||p.last_name) label,coalesce(r.label,'Puesto pendiente')||' · '||p.office_code meta
 from public.consultant_profiles p left join private.team_assignments a on a.user_id=p.user_id left join public.team_roles r on r.code=a.position_code
 where (exists(select 1 from private.panel_owners where user_id=p.user_id) or exists(select 1 from private.panel_members where user_id=p.user_id and enabled and password_set_at is not null))
 and position(q in private.panel_search_text(p.first_name||' '||p.last_name||' '||coalesce(r.label,'')||' '||p.office_code))>0 order by p.first_name,p.last_name,p.user_id limit 12) r),'[]'::jsonb),
 'resources',coalesce((select jsonb_agg(to_jsonb(r)) from (select id,title label,company||' · '||product meta from public.team_resources where not archived and position(q in private.panel_search_text(company||' '||product||' '||title))>0 order by created_at desc,id limit 12)r),'[]'::jsonb),
 'forms',coalesce((select jsonb_agg(to_jsonb(r)) from (select id,full_name label,to_char(created_at at time zone 'Atlantic/Canary','DD/MM/YYYY') meta from public.premeeting_responses where owner_id=auth.uid() and expires_at>now() and position(q in private.panel_search_text(full_name||' '||phone||' '||email))>0 order by created_at desc,id limit 12)r),'[]'::jsonb));
end; $$;
revoke all on function public.get_panel_activity(uuid,integer),public.add_client_note(uuid,text,uuid),public.get_my_client(uuid),public.get_panel_notifications(integer),public.read_panel_notification(uuid),public.search_panel(text) from public,anon;
grant execute on function public.get_panel_activity(uuid,integer),public.add_client_note(uuid,text,uuid),public.get_my_client(uuid),public.get_panel_notifications(integer),public.read_panel_notification(uuid),public.search_panel(text) to authenticated;
-- Reconstruir únicamente altas cuya fecha sí consta; no generar avisos retroactivos.
insert into private.panel_events(owner_id,client_id,kind,title,detail,target_type,target_id,source_key,happened_at)
select owner_id,id,'client.created','Contacto incorporado a tu cartera',client_type,'client',id,'client-created:'||id::text,created_at from public.portfolio_clients on conflict(owner_id,source_key) do nothing;
insert into private.panel_events(owner_id,client_id,kind,title,detail,target_type,target_id,source_key,happened_at)
select c.owner_id,c.id,'product.created',case when p.is_apex then 'APEX registrada' else 'Producto contratado registrado' end,
p.company||' · '||p.product||' · '||p.portfolio||coalesce(' · '||p.units::text||' U',''),'client',c.id,'product-created:'||p.id::text,p.created_at
from public.client_products p join public.portfolio_clients c on c.id=p.client_id on conflict(owner_id,source_key) do nothing;
commit;
