-- Tarjetas para quienes todavía no han elegido formato. Conserva todas las elecciones guardadas.
begin;
create or replace function public.get_client_view_preference()
returns text language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 return coalesce((select view_mode from private.client_view_preferences where user_id=auth.uid()),'cards');
end; $$;
revoke all on function public.get_client_view_preference() from public,anon;
grant execute on function public.get_client_view_preference() to authenticated;
commit;
