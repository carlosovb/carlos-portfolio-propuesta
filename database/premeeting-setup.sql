-- Formulario previo. Solo el propietario del panel puede leer o eliminar respuestas.
begin;
create table if not exists public.premeeting_responses (
  id uuid primary key,
  full_name text not null,
  email text not null,
  phone text not null,
  payload jsonb not null check (octet_length(payload::text) <= 80000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index if not exists premeeting_expiry on public.premeeting_responses(expires_at);
create index if not exists premeeting_date on public.premeeting_responses(created_at desc);
create index if not exists premeeting_email_date on public.premeeting_responses(email,created_at);
alter table public.premeeting_responses enable row level security;
revoke all on public.premeeting_responses from public, anon, authenticated;
grant select,delete on public.premeeting_responses to authenticated;
drop policy if exists premeeting_owner_read on public.premeeting_responses;
create policy premeeting_owner_read on public.premeeting_responses for select to authenticated
using ((select public.is_panel_owner()) and expires_at > now());
drop policy if exists premeeting_owner_delete on public.premeeting_responses;
create policy premeeting_owner_delete on public.premeeting_responses for delete to authenticated
using ((select public.is_panel_owner()) and expires_at > now());

-- Validadores internos sin permisos API. La inserción pública es una operación acotada.
create or replace function private.premeeting_money(m jsonb, months boolean default false)
returns boolean language plpgsql immutable set search_path='' as $$
begin
  if m is null or jsonb_typeof(m) is distinct from 'object' or not (m ?& array['status','value'])
    or (m - array['status','value']) <> '{}'::jsonb then return false; end if;
  if jsonb_typeof(m->'status') is distinct from 'string' then return false; end if;
  if m->>'status' in ('unknown','meeting') then return m->'value' = 'null'::jsonb; end if;
  if m->>'status' <> 'known' or jsonb_typeof(m->'value') is distinct from 'number' then return false; end if;
  return (m->>'value')::numeric between 0 and (case when months then 1200 else 100000000 end)
    and (case when months then trunc((m->>'value')::numeric)=(m->>'value')::numeric
      else round((m->>'value')::numeric,2)=(m->>'value')::numeric end);
exception when others then return false;
end; $$;
create or replace function private.premeeting_group(g jsonb, person boolean)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text; item jsonb;
begin
  if g is null or jsonb_typeof(g) is distinct from 'object' then return false; end if;
  if person then
    if not (g ?& array['first_name','last_name','age','occupation','employment','goals','income','expenses','mortgage_months','loans','assets','assets_skipped'])
      or (g - array['first_name','last_name','age','occupation','employment','goals','income','expenses','mortgage_months','loans','assets','assets_skipped']) <> '{}'::jsonb then return false; end if;
    foreach k in array array['first_name','last_name','occupation','employment'] loop
      if jsonb_typeof(g->k) is distinct from 'string' or length(trim(g->>k)) not between 1 and 120 then return false; end if;
    end loop;
    if jsonb_typeof(g->'age') is distinct from 'string' then return false; end if;
    if (g->>'age') !~ '^[0-9]{2,3}$' or (g->>'age')::int not between 18 and 120 then return false; end if;
    if jsonb_typeof(g->'income') is distinct from 'object' or not (g->'income' ?& array['salary','variable','other','extras'])
      or ((g->'income') - array['salary','variable','other','extras'])<>'{}'::jsonb then return false; end if;
    for item in select value from jsonb_each(g->'income') loop
      if not private.premeeting_money(item) then return false; end if;
    end loop;
  else
    if not (g ?& array['goals','expenses','mortgage_months','loans','assets','assets_skipped'])
      or (g - array['goals','expenses','mortgage_months','loans','assets','assets_skipped']) <> '{}'::jsonb then return false; end if;
  end if;
  if jsonb_typeof(g->'goals') is distinct from 'array' or jsonb_array_length(g->'goals')>12 then return false; end if;
  for item in select value from jsonb_array_elements(g->'goals') loop
    if jsonb_typeof(item) is distinct from 'object' or not(item ?& array['label','priority']) or (item-array['label','priority'])<>'{}'::jsonb
      or jsonb_typeof(item->'label') is distinct from 'string' or length(trim(item->>'label')) not between 1 and 120
      or jsonb_typeof(item->'priority') is distinct from 'string' or item->>'priority' not in ('','Alta','Media','Baja') then return false; end if;
  end loop;
  if jsonb_typeof(g->'expenses') is distinct from 'object' or not(g->'expenses' ?& array['rent','mortgage','utilities','food','transport','insurance','subscriptions','leisure','education','other'])
    or ((g->'expenses') - array['rent','mortgage','utilities','food','transport','insurance','subscriptions','leisure','education','other'])<>'{}'::jsonb then return false; end if;
  for item in select value from jsonb_each(g->'expenses') loop
    if not private.premeeting_money(item) then return false; end if;
  end loop;
  if not private.premeeting_money(g->'mortgage_months',true) then return false; end if;
  if jsonb_typeof(g->'loans') is distinct from 'array' or jsonb_array_length(g->'loans')>20 then return false; end if;
  for item in select value from jsonb_array_elements(g->'loans') loop
    if jsonb_typeof(item) is distinct from 'object' or not(item ?& array['label','payment','months']) or (item-array['label','payment','months'])<>'{}'::jsonb
      or jsonb_typeof(item->'label') is distinct from 'string' or length(trim(item->>'label')) not between 1 and 120
      or not private.premeeting_money(item->'payment') or not private.premeeting_money(item->'months',true) then return false; end if;
  end loop;
  if jsonb_typeof(g->'assets_skipped') is distinct from 'boolean' or jsonb_typeof(g->'assets') is distinct from 'array' or jsonb_array_length(g->'assets')>20 then return false; end if;
  for item in select value from jsonb_array_elements(g->'assets') loop
    if jsonb_typeof(item) is distinct from 'object' or not(item ?& array['product','label','amount']) or (item-array['product','label','amount'])<>'{}'::jsonb
      or jsonb_typeof(item->'product') is distinct from 'string' or length(trim(item->>'product')) not between 1 and 120
      or jsonb_typeof(item->'label') is distinct from 'string' or length(item->>'label')>120
      or not private.premeeting_money(item->'amount') then return false; end if;
  end loop;
  return true;
exception when others then return false;
end; $$;
revoke all on function private.premeeting_money(jsonb,boolean) from public,anon,authenticated;
revoke all on function private.premeeting_group(jsonb,boolean) from public,anon,authenticated;

create or replace function public.submit_premeeting(p_id uuid,p_payload jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare p jsonb; clean jsonb; email_clean text; phone_clean text; i integer;
begin
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
  if exists(select 1 from public.premeeting_responses where id=p_id) then return true; end if;
  if (select count(*) from public.premeeting_responses where created_at>now()-interval '1 hour' and (email=email_clean or phone=phone_clean))>=3
    or (select count(*) from public.premeeting_responses where created_at>now()-interval '1 day')>=300 then raise exception 'Too many forms'; end if;
  insert into public.premeeting_responses(id,full_name,email,phone,payload)
  values(p_id,trim(clean->'people'->0->>'first_name')||' '||trim(clean->'people'->0->>'last_name'),email_clean,phone_clean,clean);
  return true;
end; $$;
revoke all on function public.submit_premeeting(uuid,jsonb) from public;
grant execute on function public.submit_premeeting(uuid,jsonb) to anon,authenticated;
commit;

-- Supabase: la tarea elimina únicamente las respuestas del formulario previo.
select cron.schedule('portfolio-expired-premeeting','* * * * *',
  $$delete from public.premeeting_responses where expires_at <= now()$$);
