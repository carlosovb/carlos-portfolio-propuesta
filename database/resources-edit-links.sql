-- Edición de enlaces: solo administradores activos, sin ampliar los permisos de la tabla.
create or replace function public.update_resource(
  p_id uuid, p_product text, p_title text, p_url text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  resource_kind text;
begin
  if not coalesce(public.is_panel_owner(), false)
     or not coalesce(public.team_view_allowed(), false) then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;
  if p_product is null or length(btrim(p_product)) not between 1 and 120
     or p_title is null or length(btrim(p_title)) not between 1 and 160
     then
    raise exception 'Datos de enlace no válidos' using errcode = '22023';
  end if;
  select kind into resource_kind from public.team_resources where id = p_id for update;
  if not found then
    raise exception 'Recurso no disponible' using errcode = 'P0002';
  end if;
  if resource_kind in ('link', 'web') and (
     p_url is null or length(p_url) > 2048
     or p_url !~ '^https://[^[:space:]/?#]+[^[:space:]]*$'
     or p_url ~ '^https://[^/?#]*@') then
    raise exception 'Enlace no válido' using errcode = '22023';
  end if;
  update public.team_resources
    set product = btrim(p_product), title = btrim(p_title),
        url = case when resource_kind in ('link', 'web') then p_url else url end
    where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.update_resource(uuid,text,text,text) from public, anon;
grant execute on function public.update_resource(uuid,text,text,text) to authenticated;
