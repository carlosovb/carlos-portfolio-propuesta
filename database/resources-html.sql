-- HTML privados y presentaciones web. Conserva el acceso exclusivo de administración para publicar.
begin;
alter table public.team_resources drop constraint if exists team_resources_kind_check;
alter table public.team_resources add constraint team_resources_kind_check check(kind in ('file','link','html','web'));
alter table public.team_resources drop constraint if exists team_resources_check;
alter table public.team_resources add constraint team_resources_check check(
 (kind='file' and url is null and storage_path is not null and storage_path=id::text||'.pdf') or
 (kind='html' and url is null and storage_path is not null and storage_path=id::text||'.html') or
 (kind in ('link','web') and storage_path is null and url is not null and length(url)<=2048 and url ~ '^https://[^[:space:]]+$')
);
create or replace function public.team_resource_file_allowed(p_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.team_view_allowed() and exists(select 1 from public.team_resources r where r.kind in ('file','html') and r.storage_path=p_name);
$$;
revoke all on function public.team_resource_file_allowed(text) from public,anon;
grant execute on function public.team_resource_file_allowed(text) to authenticated;
update storage.buckets set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf','text/html'] where id='team-resources';
drop policy if exists team_resources_storage_insert on storage.objects;
create policy team_resources_storage_insert on storage.objects for insert to authenticated with check(bucket_id='team-resources' and name ~ '^[0-9a-f-]{36}\.(pdf|html)$' and public.is_panel_owner() and public.team_view_allowed());
commit;
