begin;
create table if not exists private.consultant_offices(code text primary key check(code ~ '^[A-Z0-9][A-Z0-9-]{1,11}$'),enabled boolean not null default true);
alter table private.consultant_offices enable row level security;
revoke all on private.consultant_offices from public,anon,authenticated;
insert into private.consultant_offices(code) values('LPA1') on conflict do nothing;
alter table public.consultant_profiles add column if not exists office_code text not null default 'LPA1' references private.consultant_offices(code);
alter table public.consultant_profiles add column if not exists consultant_since date;
create or replace function public.get_my_office()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.panel_access() is null then raise exception 'Not authorized' using errcode='42501'; end if;
 return jsonb_build_object('office_code',coalesce((select office_code from public.consultant_profiles where user_id=auth.uid()),'LPA1'),'offices',(select coalesce(jsonb_agg(code order by code),'[]'::jsonb) from private.consultant_offices where enabled));
end; $$;
create or replace function public.save_my_office(p_office text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare clean_code text:=upper(trim(p_office));
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if not exists(select 1 from private.consultant_offices where consultant_offices.code=clean_code and enabled) then raise exception 'Unknown office'; end if;
 update public.consultant_profiles set office_code=clean_code,updated_at=now() where user_id=auth.uid();
 if not found then raise exception 'Complete your profile first'; end if;
 return public.get_my_office();
end; $$;
create or replace function public.create_consultant_office(p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare clean_code text:=upper(trim(p_code));
begin
 if not coalesce(public.is_panel_owner(),false) then raise exception 'Not authorized' using errcode='42501'; end if;
 if clean_code is null or clean_code !~ '^[A-Z0-9][A-Z0-9-]{1,11}$' then raise exception 'Invalid office code'; end if;
 insert into private.consultant_offices(code) values(clean_code) on conflict do nothing;
 return public.get_my_office();
end; $$;
revoke all on function public.get_my_office(),public.save_my_office(text),public.create_consultant_office(text) from public,anon;
grant execute on function public.get_my_office(),public.save_my_office(text),public.create_consultant_office(text) to authenticated;
create or replace function public.panel_access()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  owner boolean;
  member private.panel_members%rowtype;
  profile public.consultant_profiles%rowtype;
begin
  if uid is null then return null; end if;
  owner := exists (select 1 from private.panel_owners where user_id = uid);
  select * into member from private.panel_members where user_id = uid and enabled;
  if not owner and member.user_id is null then return null; end if;
  select * into profile from public.consultant_profiles where user_id = uid;
  return jsonb_build_object(
    'role', case when owner then 'admin' else 'consultant' end,
    'profile_enabled', true,
    'needs_password', not owner and member.password_set_at is null,
    'profile_complete', profile.user_id is not null and (owner or member.password_set_at is not null),
    'email', (select email from auth.users where id = uid),
    'profile', case when profile.user_id is null then null else jsonb_build_object(
      'first_name', profile.first_name, 'last_name', profile.last_name, 'phone', profile.phone, 'office_code',profile.office_code,'consultant_since',profile.consultant_since
    ) end
  );
end;
$$;
revoke all on function public.panel_access() from public, anon;
grant execute on function public.panel_access() to authenticated;

drop function if exists public.save_my_profile(text,text,text);
create or replace function public.save_my_profile(p_first_name text, p_last_name text, p_phone text,p_consultant_since date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  clean_phone text := regexp_replace(p_phone, '[^0-9+]', '', 'g');
begin
  if uid is null or public.panel_access() is null then raise exception 'Not authorized'; end if;
  if p_first_name is null or p_last_name is null or p_phone is null
    or char_length(p_phone) > 30 then raise exception 'Invalid profile'; end if;
  if p_consultant_since is null and not exists(select 1 from public.consultant_profiles where user_id=uid) then raise exception 'Consultant start date required'; end if;
  if p_consultant_since is not null and (p_consultant_since<date '1900-01-01' or p_consultant_since>(now() at time zone 'Atlantic/Canary')::date) then raise exception 'Invalid consultant start date'; end if;
  if p_consultant_since is not null and exists(select 1 from public.consultant_profiles where user_id=uid and consultant_since is not null and consultant_since<>p_consultant_since) then raise exception 'Only an administrator can correct the consultant start date'; end if;
  insert into public.consultant_profiles (user_id, first_name, last_name, phone,consultant_since)
  values (uid, trim(p_first_name), trim(p_last_name), clean_phone,p_consultant_since)
  on conflict (user_id) do update set first_name = excluded.first_name,
    last_name = excluded.last_name, phone = excluded.phone,consultant_since=coalesce(public.consultant_profiles.consultant_since,excluded.consultant_since), updated_at = now();
  return public.panel_access();
end;
$$;
revoke all on function public.save_my_profile(text,text,text,date) from public, anon;
grant execute on function public.save_my_profile(text,text,text,date) to authenticated;

create or replace function public.get_panel_presence()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'name',trim(p.first_name||' '||p.last_name),'position_code',a.position_code,'position',r.label,'office_code',p.office_code) order by p.first_name,p.last_name),'[]'::jsonb)
 from public.consultant_profiles p left join private.team_assignments a on a.user_id=p.user_id left join public.team_roles r on r.code=a.position_code where exists(select 1 from private.panel_presence s where s.user_id=p.user_id and s.last_seen>now()-interval '90 seconds')
 and (exists(select 1 from private.panel_owners o where o.user_id=p.user_id) or exists(select 1 from private.panel_members m where m.user_id=p.user_id and m.enabled)));
end; $$;
create or replace function public.get_team_directory()
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if not public.team_view_allowed() then raise exception 'Not authorized'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'is_root',exists(select 1 from private.panel_owners o where o.user_id=a.user_id),
   'first_name',p.first_name,'last_name',p.last_name,'office_code',p.office_code,'consultant_since',p.consultant_since,'position_code',a.position_code,
   'position',r.label,'multiplier',r.multiplier,'manager_id',a.manager_id,
   'avatar_path',case when exists(select 1 from storage.objects o where o.bucket_id='consultant-avatars' and o.name=a.user_id::text||'/portrait.webp') then a.user_id::text||'/portrait.webp' else null end)
   order by p.first_name,p.last_name)
 from private.team_assignments a join public.consultant_profiles p on p.user_id=a.user_id
 left join public.team_roles r on r.code=a.position_code
 where exists(select 1 from private.panel_owners o where o.user_id=a.user_id)
 or exists(select 1 from private.panel_members m where m.user_id=a.user_id and m.enabled and m.password_set_at is not null)), '[]'::jsonb);
end;
$fn$;
revoke all on function public.get_team_directory() from public, anon;
grant execute on function public.get_team_directory() to authenticated;


create or replace function public.admin_set_consultant_since(p_user uuid,p_since date)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_panel_owner(),false) then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_since is null or p_since<date '1900-01-01' or p_since>(now() at time zone 'Atlantic/Canary')::date then raise exception 'Invalid consultant start date'; end if;
 update public.consultant_profiles set consultant_since=p_since,updated_at=now() where user_id=p_user;
 return found;
end; $$;
revoke all on function public.admin_set_consultant_since(uuid,date) from public,anon;
grant execute on function public.admin_set_consultant_since(uuid,date) to authenticated;

commit;
