-- Ejecutar después de profile-setup.sql. Solo el propietario puede listar al equipo.
begin;
create or replace function public.list_consultants()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.is_panel_owner(), false) then raise exception 'Not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'user_id', u.id,
    'can_delete', u.invited_at is not null and u.last_sign_in_at is null and m.password_set_at is null,
    'email', u.email,
    'name', nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
    'enabled', m.enabled,
    'complete', p.user_id is not null and m.password_set_at is not null
  ) order by u.created_at desc)
  from private.panel_members m join auth.users u on u.id = m.user_id
  left join public.consultant_profiles p on p.user_id = m.user_id
  where not exists (select 1 from private.panel_owners o where o.user_id = m.user_id)), '[]'::jsonb);
end;
$$;
revoke all on function public.list_consultants() from public, anon;
grant execute on function public.list_consultants() to authenticated;
-- Bloquear primero la cuenta pendiente para invalidar cualquier acceso simultáneo.
create or replace function public.cancel_pending_invitation(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $cancel$
declare candidate auth.users%rowtype;
begin
  if not coalesce(public.is_panel_owner(), false) then raise exception 'Not authorized'; end if;
  select * into candidate from auth.users where id = p_user_id for update;
  if not found or candidate.invited_at is null or candidate.last_sign_in_at is not null
    or exists (select 1 from private.panel_owners where user_id = p_user_id)
    or not exists (select 1 from private.panel_members where user_id = p_user_id and password_set_at is null)
  then return false; end if;
  update private.panel_members set enabled = false where user_id = p_user_id;
  return true;
end;
$cancel$;
revoke all on function public.cancel_pending_invitation(uuid) from public, anon;
grant execute on function public.cancel_pending_invitation(uuid) to authenticated;
commit;
