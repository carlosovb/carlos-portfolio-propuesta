-- Evolución: cada consultor recibe y consulta solo sus propios formularios.
begin;
create or replace function public.premeeting_consultant(p_consultant uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.user_id,'name',p.first_name||' '||p.last_name,'is_root',exists(select 1 from private.panel_owners o where o.user_id=p.user_id))
 from public.consultant_profiles p
 where p.user_id=coalesce(p_consultant,(select user_id from private.panel_owners order by user_id limit 1))
 and (exists(select 1 from private.panel_owners o where o.user_id=p.user_id)
 or exists(select 1 from private.panel_members m where m.user_id=p.user_id and m.enabled and m.password_set_at is not null));
$$;
revoke all on function public.premeeting_consultant(uuid) from public;
grant execute on function public.premeeting_consultant(uuid) to anon,authenticated;
alter table public.premeeting_responses add column if not exists owner_id uuid references auth.users(id) on delete cascade;
update public.premeeting_responses set owner_id=(select user_id from private.panel_owners order by user_id limit 1) where owner_id is null;
alter table public.premeeting_responses alter column owner_id set not null;
create index if not exists premeeting_owner_date on public.premeeting_responses(owner_id,created_at desc);
drop policy if exists premeeting_owner_read on public.premeeting_responses;
drop policy if exists premeeting_owner_delete on public.premeeting_responses;
create policy premeeting_owner_read on public.premeeting_responses for select to authenticated using(owner_id=(select auth.uid()) and (select public.team_view_allowed()) and expires_at>now());
create policy premeeting_owner_delete on public.premeeting_responses for delete to authenticated using(owner_id=(select auth.uid()) and (select public.team_view_allowed()) and expires_at>now());
drop function if exists public.submit_premeeting(uuid,jsonb);
create or replace function public.submit_premeeting(p_id uuid,p_payload jsonb,p_consultant uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare p jsonb; clean jsonb; email_clean text; phone_clean text; i integer; target uuid;
begin
  target := (public.premeeting_consultant(p_consultant)->>'id')::uuid;
  if target is null then raise exception 'Consultant unavailable'; end if;
  if p_id is null or p_payload is null or octet_length(p_payload::text)>80000
    or jsonb_typeof(p_payload) is distinct from 'object' or not(p_payload ?& array['version','mode','contact','people','shared','consent'])
    or (p_payload-array['version','mode','contact','people','shared','consent'])<>'{}'::jsonb
    or p_payload->'version' is distinct from '1'::jsonb or p_payload->'consent' is distinct from 'true'::jsonb
    or jsonb_typeof(p_payload->'mode') is distinct from 'string' or p_payload->>'mode' not in ('individual','couple')
    or jsonb_typeof(p_payload->'people') is distinct from 'array' then raise exception 'Invalid form'; end if;
  if jsonb_array_length(p_payload->'people') <> (case when p_payload->>'mode'='couple' then 2 else 1 end) then raise exception 'Invalid people'; end if;
  if jsonb_typeof(p_payload->'contact') is distinct from 'object' or not(p_payload->'contact' ?& array['email','phone'])
    or ((p_payload->'contact') - array['email','phone'])<>'{}'::jsonb
    or jsonb_typeof(p_payload->'contact'->'email') is distinct from 'string' or jsonb_typeof(p_payload->'contact'->'phone') is distinct from 'string' then raise exception 'Invalid contact'; end if;
  email_clean:=lower(trim(p_payload->'contact'->>'email'));
  phone_clean:=regexp_replace(p_payload->'contact'->>'phone','[^0-9+]','','g');
  if length(email_clean)>254 or email_clean !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or phone_clean !~ '^\+?[0-9]{7,20}$' then raise exception 'Invalid contact'; end if;
  for p in select value from jsonb_array_elements(p_payload->'people') loop
    if not private.premeeting_group(p,true) then raise exception 'Invalid person'; end if;
  end loop;
  if not private.premeeting_group(p_payload->'shared',false) then raise exception 'Invalid shared'; end if;
  clean:=p_payload;
  -- Al saltar ahorro no conservar los datos que se hubieran escrito previamente.
  for i in 0..jsonb_array_length(clean->'people')-1 loop
    if clean->'people'->i->'assets_skipped'='true'::jsonb then clean:=jsonb_set(clean,array['people',i::text,'assets'],'[]'); end if;
  end loop;
  if clean->'shared'->'assets_skipped'='true'::jsonb then clean:=jsonb_set(clean,'{shared,assets}','[]'); end if;
  if not exists(select 1 from private.panel_owners) then raise exception 'Not configured'; end if;
  perform pg_advisory_xact_lock(hashtextextended('premeeting-submissions',0));
  -- Respuesta uniforme al reintentar; nunca se devuelve la respuesta guardada.
  if exists(select 1 from public.premeeting_responses where id=p_id and owner_id=target) then return true; end if;
  if (select count(*) from public.premeeting_responses where owner_id=target and created_at>now()-interval '1 hour' and (email=email_clean or phone=phone_clean))>=3
    or (select count(*) from public.premeeting_responses where created_at>now()-interval '1 day')>=300 then raise exception 'Too many forms'; end if;
  insert into public.premeeting_responses(id,owner_id,full_name,email,phone,payload)
  values(p_id,target,trim(clean->'people'->0->>'first_name')||' '||trim(clean->'people'->0->>'last_name'),email_clean,phone_clean,clean);
  return true;
end; $$;
revoke all on function public.submit_premeeting(uuid,jsonb,uuid) from public;
grant execute on function public.submit_premeeting(uuid,jsonb,uuid) to anon,authenticated;

create table if not exists public.team_resources (
 id uuid primary key,
 company text not null check(length(trim(company)) between 1 and 120),
 product text not null check(length(trim(product)) between 1 and 120),
 title text not null check(length(trim(title)) between 1 and 160),
 kind text not null check(kind in ('file','link')),
 url text,
 storage_path text,
 archived boolean not null default false,
 created_at timestamptz not null default now(),
 check((kind='file' and url is null and storage_path is not null and storage_path=id::text||'.pdf') or
       (kind='link' and storage_path is null and url is not null and length(url)<=2048 and url ~ '^https://[^[:space:]]+$'))
);
alter table public.team_resources enable row level security;
revoke all on public.team_resources from public,anon,authenticated;
grant select,delete on public.team_resources to authenticated;
grant insert(id,company,product,title,kind,url,storage_path) on public.team_resources to authenticated;
grant update(archived) on public.team_resources to authenticated;
create index if not exists team_resources_company_product on public.team_resources(company,product,archived,created_at desc);
drop policy if exists team_resources_read on public.team_resources;
create policy team_resources_read on public.team_resources for select to authenticated using((select public.team_view_allowed()));
drop policy if exists team_resources_insert on public.team_resources;
create policy team_resources_insert on public.team_resources for insert to authenticated with check((select public.is_panel_owner()) and (select public.team_view_allowed()));
drop policy if exists team_resources_archive on public.team_resources;
create policy team_resources_archive on public.team_resources for update to authenticated using((select public.is_panel_owner()) and (select public.team_view_allowed())) with check((select public.is_panel_owner()) and (select public.team_view_allowed()));
drop policy if exists team_resources_delete on public.team_resources;
create policy team_resources_delete on public.team_resources for delete to authenticated using((select public.is_panel_owner()) and (select public.team_view_allowed()));
create or replace function public.team_resource_file_allowed(p_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.team_view_allowed() and exists(select 1 from public.team_resources r where r.kind='file' and r.storage_path=p_name);
$$;
revoke all on function public.team_resource_file_allowed(text) from public,anon;
grant execute on function public.team_resource_file_allowed(text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('team-resources','team-resources',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists team_resources_storage_read on storage.objects;
create policy team_resources_storage_read on storage.objects for select to authenticated using(bucket_id='team-resources' and (public.team_resource_file_allowed(name) or (public.is_panel_owner() and public.team_view_allowed())));
drop policy if exists team_resources_storage_insert on storage.objects;
create policy team_resources_storage_insert on storage.objects for insert to authenticated with check(bucket_id='team-resources' and name ~ '^[0-9a-f-]{36}\.pdf$' and public.is_panel_owner() and public.team_view_allowed());
drop policy if exists team_resources_storage_delete on storage.objects;
create policy team_resources_storage_delete on storage.objects for delete to authenticated using(bucket_id='team-resources' and public.is_panel_owner() and public.team_view_allowed());
commit;
