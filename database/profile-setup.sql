-- Ejecutar una vez en SQL Editor. No contiene datos personales ni contraseñas.
-- Amplía el panel sin conceder a RED acceso a las solicitudes de clientes.
begin;

create table if not exists private.panel_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  password_set_at timestamptz
);
alter table private.panel_members enable row level security;
revoke all on private.panel_members from public, anon, authenticated;

create table if not exists public.consultant_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(trim(first_name)) between 1 and 80),
  last_name text not null check (char_length(trim(last_name)) between 1 and 120),
  phone text not null check (phone ~ '^\+?[0-9]{7,20}$'),
  updated_at timestamptz not null default now()
);
alter table public.consultant_profiles enable row level security;
revoke all on public.consultant_profiles from public, anon, authenticated;

-- La invitación administrativa es la que autoriza a un miembro, no user_metadata.
create or replace function private.register_invited_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.invited_at is not null then
    insert into private.panel_members (user_id) values (new.id) on conflict do nothing;
    if tg_op = 'UPDATE' then
      if new.encrypted_password is distinct from old.encrypted_password
        and coalesce(new.encrypted_password, '') <> '' then
        update private.panel_members set password_set_at = now() where user_id = new.id;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.register_invited_member() from public, anon, authenticated;
drop trigger if exists portfolio_invited_member on auth.users;
create trigger portfolio_invited_member
after insert or update of invited_at, encrypted_password on auth.users
for each row execute function private.register_invited_member();

insert into private.panel_members (user_id)
select id from auth.users where invited_at is not null
on conflict do nothing;

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
      'first_name', profile.first_name, 'last_name', profile.last_name, 'phone', profile.phone
    ) end
  );
end;
$$;
revoke all on function public.panel_access() from public, anon;
grant execute on function public.panel_access() to authenticated;

create or replace function public.save_my_profile(p_first_name text, p_last_name text, p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  clean_phone text := regexp_replace(p_phone, '[^0-9+]', '', 'g');
begin
  if uid is null or public.panel_access() is null then raise exception 'Not authorized'; end if;
  if p_first_name is null or p_last_name is null or p_phone is null
    or char_length(p_phone) > 30 then raise exception 'Invalid profile'; end if;
  insert into public.consultant_profiles (user_id, first_name, last_name, phone)
  values (uid, trim(p_first_name), trim(p_last_name), clean_phone)
  on conflict (user_id) do update set first_name = excluded.first_name,
    last_name = excluded.last_name, phone = excluded.phone, updated_at = now();
  return public.panel_access();
end;
$$;
revoke all on function public.save_my_profile(text,text,text) from public, anon;
grant execute on function public.save_my_profile(text,text,text) to authenticated;

-- No se conceden INSERT/UPDATE/SELECT directos: el perfil se lee mediante panel_access
-- y solo se modifica a través de save_my_profile, siempre para auth.uid().
-- is_panel_owner y los permisos de contact_requests permanecen intactos.
commit;
