-- Cada consultor consulta su propio progreso y el de todos sus descendientes.
-- El árbol y las fichas profesionales conservan su visibilidad compartida.
begin;
create or replace function public.get_career_progress(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_user_id is null or not (exists(with recursive permitted as (select auth.uid() user_id union select a.user_id from private.team_assignments a join permitted p on a.manager_id=p.user_id) select 1 from permitted where user_id=p_user_id)) then raise exception 'Progress not authorized' using errcode='42501'; end if;
 if not exists(select 1 from jsonb_array_elements(public.get_team_directory()) p where (p->>'user_id')::uuid=p_user_id) then raise exception 'Profile unavailable' using errcode='42501'; end if;
 with recursive branch as (
   select a.user_id,a.position_code,array[p_user_id,a.user_id] path from private.team_assignments a where a.manager_id=p_user_id and a.user_id<>p_user_id
   union all
   select a.user_id,a.position_code,b.path||a.user_id from private.team_assignments a join branch b on a.manager_id=b.user_id where not a.user_id=any(b.path)
 ), visible as (select (p->>'user_id')::uuid user_id from jsonb_array_elements(public.get_team_directory()) p), counts as (
   select b.position_code,count(*) n from branch b join visible v on v.user_id=b.user_id where b.position_code is not null group by b.position_code
 ) select coalesce(jsonb_object_agg(position_code,n),'{}'::jsonb) into result from counts;
 return jsonb_build_object('user_id',p_user_id,'counts',result,'units_available',false);
end;
$$;
revoke all on function public.get_career_progress(uuid) from public,anon;
grant execute on function public.get_career_progress(uuid) to authenticated;
commit;
