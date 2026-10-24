-- Datos profesionales visibles en las fichas del equipo; la edición sigue reservada al administrador.
begin;
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
commit;
