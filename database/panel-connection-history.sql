-- Historial agregado por consultor. No expone sesiones, correos ni datos de clientes.
begin;
create table if not exists private.panel_connection_visits (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 connected_at timestamptz not null default clock_timestamp(),
 last_seen_at timestamptz not null default clock_timestamp(),
 disconnected_at timestamptz,
 disconnect_inferred boolean not null default false
);
create unique index if not exists panel_connection_one_open on private.panel_connection_visits(user_id) where disconnected_at is null;
create index if not exists panel_connection_user_history on private.panel_connection_visits(user_id,connected_at desc);
create index if not exists panel_connection_recent on private.panel_connection_visits(connected_at desc);
create index if not exists panel_connection_recent_end on private.panel_connection_visits(disconnected_at desc) where disconnected_at is not null;
create index if not exists panel_connection_user_end on private.panel_connection_visits(user_id,disconnected_at desc) where disconnected_at is not null;
alter table private.panel_connection_visits enable row level security;
revoke all on private.panel_connection_visits from public,anon,authenticated;
alter table private.panel_presence add column if not exists visit_id uuid references private.panel_connection_visits(id) on delete set null;
alter table private.panel_presence add column if not exists disconnected_at timestamptz;
create index if not exists panel_presence_visit on private.panel_presence(visit_id,last_seen desc) where disconnected_at is null;

-- La hora inferida es el vencimiento de la última pestaña, no la hora de lectura.
create or replace function private.expire_panel_connections()
returns void language sql set search_path='' as $$
 with expired as (
  select v.id,least(clock_timestamp(),greatest(v.connected_at,coalesce(
   (select max(s.last_seen) from private.panel_presence s where s.visit_id=v.id and s.disconnected_at is null),v.last_seen_at)+interval '90 seconds')) as ended
  from private.panel_connection_visits v where v.disconnected_at is null
  and not exists(select 1 from private.panel_presence s where s.visit_id=v.id and s.disconnected_at is null and s.last_seen>clock_timestamp()-interval '90 seconds')
  order by v.id for update of v skip locked
 ) update private.panel_connection_visits v set disconnected_at=e.ended,disconnect_inferred=true from expired e where e.id=v.id;
$$;
revoke all on function private.expire_panel_connections() from public,anon,authenticated;

-- Se mantiene el contrato anterior para pestañas que aún no han actualizado el código.
create or replace function public.get_panel_presence()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'name',trim(p.first_name||' '||p.last_name),'position_code',a.position_code,'position',r.label,'office_code',p.office_code,
 'last_connected_at',(select max(v.connected_at) from private.panel_connection_visits v where v.user_id=p.user_id)) order by p.first_name,p.last_name),'[]'::jsonb)
 from public.consultant_profiles p left join private.team_assignments a on a.user_id=p.user_id left join public.team_roles r on r.code=a.position_code
 where exists(select 1 from private.panel_presence s where s.user_id=p.user_id and s.disconnected_at is null and s.last_seen>now()-interval '90 seconds')
 and (exists(select 1 from private.panel_owners o where o.user_id=p.user_id) or exists(select 1 from private.panel_members m where m.user_id=p.user_id and m.enabled)));
end; $$;

create or replace function public.update_panel_presence(p_session uuid,p_connected boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); t timestamptz; vid uuid; closed timestamptz; seen timestamptz;
begin
 if u is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_session is null or p_connected is null then raise exception 'Invalid presence session'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 t:=clock_timestamp();
 if p_connected then
  select s.disconnected_at into closed from private.panel_presence s where s.user_id=u and s.session_id=p_session;
  -- Una petición retrasada no reabre una pestaña que ya notificó su cierre.
  if closed is not null then return public.get_panel_presence(); end if;
  select v.id into vid from private.panel_connection_visits v where v.user_id=u and v.disconnected_at is null for update;
  if vid is not null and not exists(select 1 from private.panel_presence s where s.visit_id=vid and s.disconnected_at is null and s.last_seen>t-interval '90 seconds') then
   select coalesce(max(s.last_seen),(select v.last_seen_at from private.panel_connection_visits v where v.id=vid)) into seen from private.panel_presence s where s.visit_id=vid and s.disconnected_at is null;
   update private.panel_connection_visits set disconnected_at=least(t,greatest(connected_at,seen+interval '90 seconds')),disconnect_inferred=true where id=vid;
   vid:=null;
  end if;
  if vid is null then insert into private.panel_connection_visits(user_id,connected_at,last_seen_at) values(u,t,t) returning id into vid; end if;
  insert into private.panel_presence(user_id,session_id,last_seen,visit_id) values(u,p_session,t,vid)
  on conflict(user_id,session_id) do update set last_seen=excluded.last_seen,visit_id=excluded.visit_id where private.panel_presence.disconnected_at is null;
  update private.panel_connection_visits set last_seen_at=t where id=vid;
 else
  insert into private.panel_presence(user_id,session_id,last_seen,disconnected_at) values(u,p_session,t,t)
  on conflict(user_id,session_id) do update set disconnected_at=coalesce(private.panel_presence.disconnected_at,excluded.disconnected_at)
  returning visit_id into vid;
  if vid is not null then
   perform 1 from private.panel_connection_visits where id=vid for update;
   if not exists(select 1 from private.panel_presence s where s.visit_id=vid and s.disconnected_at is null and s.last_seen>t-interval '90 seconds') then
    update private.panel_connection_visits set disconnected_at=t,disconnect_inferred=false where id=vid and disconnected_at is null;
   end if;
  end if;
 end if;
 delete from private.panel_presence where user_id=u and last_seen<t-interval '1 day';
 return public.get_panel_presence();
end; $$;

create or replace function public.get_panel_connection_activity()
returns jsonb language plpgsql security definer set search_path='' as $$
declare people jsonb; events jsonb;
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 perform private.expire_panel_connections();
 select coalesce(jsonb_agg(jsonb_build_object(
  'user_id',p.user_id,'name',trim(p.first_name||' '||p.last_name),'position_code',a.position_code,'position',r.label,'office_code',p.office_code,
  'online',exists(select 1 from private.panel_presence s where s.user_id=p.user_id and s.disconnected_at is null and s.last_seen>now()-interval '90 seconds'),
  'last_connected_at',(select max(v.connected_at) from private.panel_connection_visits v where v.user_id=p.user_id),
  'last_disconnected_at',(select max(v.disconnected_at) from private.panel_connection_visits v where v.user_id=p.user_id),
  'last_seen_at',greatest((select max(v.last_seen_at) from private.panel_connection_visits v where v.user_id=p.user_id),(select max(s.last_seen) from private.panel_presence s where s.user_id=p.user_id and (s.visit_id is not null or s.disconnected_at is null)))) order by p.first_name,p.last_name),'[]'::jsonb)
 into people from public.consultant_profiles p left join private.team_assignments a on a.user_id=p.user_id left join public.team_roles r on r.code=a.position_code
 where exists(select 1 from private.panel_owners o where o.user_id=p.user_id) or exists(select 1 from private.panel_members m where m.user_id=p.user_id and m.enabled);
 with movements as (
  (select v.id::text||'-in' as id,v.user_id,'connected'::text as kind,v.connected_at as occurred_at,false as inferred from private.panel_connection_visits v
   where exists(select 1 from private.panel_owners o where o.user_id=v.user_id) or exists(select 1 from private.panel_members m where m.user_id=v.user_id and m.enabled)
   order by v.connected_at desc,v.id desc limit 30)
  union all
  (select v.id::text||'-out',v.user_id,'disconnected',v.disconnected_at,v.disconnect_inferred from private.panel_connection_visits v where v.disconnected_at is not null
   and (exists(select 1 from private.panel_owners o where o.user_id=v.user_id) or exists(select 1 from private.panel_members m where m.user_id=v.user_id and m.enabled))
   order by v.disconnected_at desc,v.id desc limit 30)
 ), recent as (
  select m.id,m.user_id,m.kind,m.occurred_at,m.inferred,p.first_name,p.last_name
  from movements m join public.consultant_profiles p on p.user_id=m.user_id
  where exists(select 1 from private.panel_owners o where o.user_id=p.user_id) or exists(select 1 from private.panel_members b where b.user_id=p.user_id and b.enabled)
  order by m.occurred_at desc,m.id desc limit 30
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'name',trim(first_name||' '||last_name),'kind',kind,'occurred_at',occurred_at,'inferred',inferred) order by occurred_at desc,id desc),'[]'::jsonb) into events from recent;
 return jsonb_build_object('people',people,'events',events,'observed_at',clock_timestamp());
end; $$;

create or replace function public.update_panel_connection_presence(p_session uuid,p_connected boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.update_panel_presence(p_session,p_connected);
 return public.get_panel_connection_activity();
end; $$;
revoke all on function public.get_panel_presence(),public.update_panel_presence(uuid,boolean),public.get_panel_connection_activity(),public.update_panel_connection_presence(uuid,boolean) from public,anon;
grant execute on function public.get_panel_presence(),public.update_panel_presence(uuid,boolean),public.get_panel_connection_activity(),public.update_panel_connection_presence(uuid,boolean) to authenticated;
commit;
