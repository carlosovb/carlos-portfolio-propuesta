-- Directorio profesional interno: no expone teléfonos, correos ni datos de clientes.
begin;
create table if not exists public.team_roles (
  code text primary key,
  label text not null,
  multiplier numeric(3,1) not null check (multiplier > 0)
);
alter table public.team_roles enable row level security;
revoke all on public.team_roles from public, anon, authenticated;
insert into public.team_roles(code,label,multiplier) values
 ('financial_trainee','Financial Trainee',2),
 ('financial_consultant','Financial Consultant',2.5),
 ('team_manager','Gestor de Equipo',3.5)
on conflict(code) do update set label=excluded.label, multiplier=excluded.multiplier;

create table if not exists private.team_assignments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  position_code text references public.team_roles(code),
  manager_id uuid references private.team_assignments(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  check (manager_id is null or manager_id <> user_id)
);
create index if not exists team_assignments_manager_idx on private.team_assignments(manager_id);
alter table private.team_assignments enable row level security;
revoke all on private.team_assignments from public, anon, authenticated;

create or replace function private.register_team_assignment()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  insert into private.team_assignments(user_id,manager_id)
  values(new.user_id,case when exists(select 1 from private.panel_owners where user_id=new.user_id) then null
    else (select user_id from private.panel_owners order by user_id limit 1) end)
  on conflict(user_id) do update set manager_id=case when exists(select 1 from private.panel_owners where user_id=new.user_id) then null else private.team_assignments.manager_id end;
  return new;
end;
$fn$;
revoke all on function private.register_team_assignment() from public, anon, authenticated;
drop trigger if exists portfolio_member_team on private.panel_members;
create trigger portfolio_member_team after insert on private.panel_members
for each row execute function private.register_team_assignment();
drop trigger if exists portfolio_owner_team on private.panel_owners;
create trigger portfolio_owner_team after insert on private.panel_owners
for each row execute function private.register_team_assignment();
insert into private.team_assignments(user_id)
select user_id from private.panel_owners union select user_id from private.panel_members
on conflict do nothing;
-- El administrador es la raíz; las incorporaciones directas dependen de él.
update private.team_assignments a set manager_id=null where exists(select 1 from private.panel_owners o where o.user_id=a.user_id);
update private.team_assignments a set manager_id=(select user_id from private.panel_owners order by user_id limit 1)
where a.manager_id is null and not exists(select 1 from private.panel_owners o where o.user_id=a.user_id);

create or replace function public.team_view_allowed()
returns boolean language sql stable security definer set search_path='' as $fn$
 select auth.uid() is not null and coalesce((public.panel_access()->>'profile_complete')::boolean,false);
$fn$;
revoke all on function public.team_view_allowed() from public, anon;
grant execute on function public.team_view_allowed() to authenticated;

create or replace function public.get_my_team_profile()
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if auth.uid() is null or public.panel_access() is null then raise exception 'Not authorized'; end if;
 return (select jsonb_build_object('user_id',a.user_id,'is_root',exists(select 1 from private.panel_owners o where o.user_id=a.user_id),'position_code',a.position_code,
   'position',r.label,'multiplier',r.multiplier,'manager_id',a.manager_id,
   'manager_name',nullif(trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),''),
   'avatar_path',case when exists(select 1 from storage.objects o where o.bucket_id='consultant-avatars' and o.name=a.user_id::text||'/portrait.webp') then a.user_id::text||'/portrait.webp' else null end)
 from private.team_assignments a left join public.team_roles r on r.code=a.position_code
 left join public.consultant_profiles p on p.user_id=a.manager_id where a.user_id=auth.uid());
end;
$fn$;
revoke all on function public.get_my_team_profile() from public, anon;
grant execute on function public.get_my_team_profile() to authenticated;

create or replace function public.get_team_directory()
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if not public.team_view_allowed() then raise exception 'Not authorized'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'is_root',exists(select 1 from private.panel_owners o where o.user_id=a.user_id),
   'first_name',p.first_name,'last_name',p.last_name,'position_code',a.position_code,
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

create or replace function public.save_team_assignment(p_user_id uuid,p_position_code text,p_manager_id uuid)
returns void language plpgsql security definer set search_path='' as $fn$
begin
 if not coalesce(public.is_panel_owner(),false) then raise exception 'Not authorized'; end if;
 -- Serializar cambios para impedir ciclos creados por dos administradores simultáneos.
 perform pg_advisory_xact_lock(782193601);
 if not exists(select 1 from private.team_assignments where user_id=p_user_id) then raise exception 'Unknown member'; end if;
 if p_position_code is not null and not exists(select 1 from public.team_roles where code=p_position_code) then raise exception 'Invalid position'; end if;
 if exists(select 1 from private.panel_owners where user_id=p_user_id) then
   if p_manager_id is not null and p_manager_id <> p_user_id then raise exception 'Root manager cannot change'; end if;
   p_manager_id := null;
 elsif p_manager_id is null then
   p_manager_id := (select user_id from private.panel_owners order by user_id limit 1);
 end if;
 if p_manager_id is not null then
   if p_manager_id=p_user_id or not exists(select 1 from private.team_assignments where user_id=p_manager_id) then raise exception 'Invalid manager'; end if;
   if exists(with recursive parents as (
     select user_id,manager_id from private.team_assignments where user_id=p_manager_id
     union select a.user_id,a.manager_id from private.team_assignments a join parents t on a.user_id=t.manager_id
   ) select 1 from parents where user_id=p_user_id) then raise exception 'Hierarchy cycle'; end if;
 end if;
 update private.team_assignments set position_code=p_position_code,manager_id=p_manager_id,updated_at=now() where user_id=p_user_id;
end;
$fn$;
revoke all on function public.save_team_assignment(uuid,text,uuid) from public, anon;
grant execute on function public.save_team_assignment(uuid,text,uuid) to authenticated;

create or replace function public.can_read_team_avatar(p_name text)
returns boolean language plpgsql stable security definer set search_path='' as $avatar$
begin
 if auth.uid() is null or public.panel_access() is null then return false; end if;
 if p_name=auth.uid()::text||'/portrait.webp' then return true; end if;
 if not public.team_view_allowed() then return false; end if;
 return exists(select 1 from public.consultant_profiles p where p_name=p.user_id::text||'/portrait.webp' and (
 exists(select 1 from private.panel_owners o where o.user_id=p.user_id) or
 exists(select 1 from private.panel_members m where m.user_id=p.user_id and m.enabled and m.password_set_at is not null)));
end;
$avatar$;
revoke all on function public.can_read_team_avatar(text) from public, anon;
grant execute on function public.can_read_team_avatar(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('consultant-avatars','consultant-avatars',false,1048576,array['image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists team_avatar_read on storage.objects;
create policy team_avatar_read on storage.objects for select to authenticated using (
 bucket_id='consultant-avatars' and public.can_read_team_avatar(name)
);
drop policy if exists team_avatar_insert on storage.objects;
create policy team_avatar_insert on storage.objects for insert to authenticated with check (
 bucket_id='consultant-avatars' and name=auth.uid()::text||'/portrait.webp' and public.panel_access() is not null
);
drop policy if exists team_avatar_update on storage.objects;
create policy team_avatar_update on storage.objects for update to authenticated using (
 bucket_id='consultant-avatars' and name=auth.uid()::text||'/portrait.webp' and public.panel_access() is not null
) with check (bucket_id='consultant-avatars' and name=auth.uid()::text||'/portrait.webp' and public.panel_access() is not null);
drop policy if exists team_avatar_delete on storage.objects;
create policy team_avatar_delete on storage.objects for delete to authenticated using (
 bucket_id='consultant-avatars' and name=auth.uid()::text||'/portrait.webp' and public.panel_access() is not null
);
commit;
