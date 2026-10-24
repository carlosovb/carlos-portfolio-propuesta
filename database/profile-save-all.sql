-- Guardado único y atómico; mantiene la protección de la fecha y del puesto.
begin;
create or replace function public.save_profile_details(p_first_name text,p_last_name text,p_phone text,p_consultant_since date,p_office text,p_position text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.panel_access() is null then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_position is not null and not coalesce(public.is_panel_owner(),false) then raise exception 'Only administrators can change positions' using errcode='42501'; end if;
 perform public.save_my_profile(p_first_name,p_last_name,p_phone,p_consultant_since);
 perform public.save_my_office(p_office);
 if p_position is not null then
  perform public.save_team_assignment(auth.uid(),nullif(p_position,''),(select manager_id from private.team_assignments where user_id=auth.uid()));
 end if;
 return public.panel_access();
end; $$;
revoke all on function public.save_profile_details(text,text,text,date,text,text) from public,anon;
grant execute on function public.save_profile_details(text,text,text,date,text,text) to authenticated;
commit;
