-- Presencia efímera por pestaña; ningún permiso directo sobre sesiones ajenas.
begin;
create table if not exists private.panel_presence(user_id uuid not null references auth.users(id) on delete cascade,session_id uuid not null,last_seen timestamptz not null default now(),primary key(user_id,session_id));
create index if not exists panel_presence_seen on private.panel_presence(last_seen);
alter table private.panel_presence enable row level security;
revoke all on private.panel_presence from public,anon,authenticated;
create or replace function public.get_panel_presence()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'name',trim(p.first_name||' '||p.last_name)) order by p.first_name,p.last_name),'[]'::jsonb)
 from public.consultant_profiles p where exists(select 1 from private.panel_presence s where s.user_id=p.user_id and s.last_seen>now()-interval '90 seconds')
 and (exists(select 1 from private.panel_owners o where o.user_id=p.user_id) or exists(select 1 from private.panel_members m where m.user_id=p.user_id and m.enabled)));
end; $$;
create or replace function public.update_panel_presence(p_session uuid,p_connected boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_session is null or p_connected is null then raise exception 'Invalid presence session'; end if;
 if p_connected then
  insert into private.panel_presence(user_id,session_id,last_seen) values(auth.uid(),p_session,clock_timestamp()) on conflict(user_id,session_id) do update set last_seen=excluded.last_seen;
  delete from private.panel_presence where last_seen<now()-interval '1 day';
 else delete from private.panel_presence where user_id=auth.uid() and session_id=p_session;
 end if;
 return public.get_panel_presence();
end; $$;
revoke all on function public.get_panel_presence() from public,anon;
revoke all on function public.update_panel_presence(uuid,boolean) from public,anon;
grant execute on function public.get_panel_presence(),public.update_panel_presence(uuid,boolean) to authenticated;
commit;
