-- Ejecutar en el SQL Editor del proyecto Supabase, no en GitHub.
-- No contiene contraseñas, claves privadas ni datos de clientes.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.panel_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table private.panel_owners enable row level security;
revoke all on private.panel_owners from public, anon, authenticated;

create table if not exists public.contact_requests (
  id uuid primary key,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  phone text not null check (char_length(phone) between 7 and 30),
  email text not null check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  reasons text[] not null default '{}' check (cardinality(reasons) <= 8),
  call_time text not null check (call_time in ('mañana', 'tarde', 'indiferente')),
  comment text not null default '' check (char_length(comment) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'contacted', 'scheduled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 days')
);
create index if not exists contact_requests_date on public.contact_requests (created_at desc);
create index if not exists contact_requests_expiry on public.contact_requests (expires_at);
alter table public.contact_requests enable row level security;

create or replace function public.is_panel_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.panel_owners where user_id = (select auth.uid()));
$$;
revoke all on function public.is_panel_owner() from public, anon;
grant execute on function public.is_panel_owner() to authenticated;

-- La autorización está en la base de datos: no basta con acceder al HTML del panel.
drop policy if exists owner_select on public.contact_requests;
create policy owner_select on public.contact_requests for select to authenticated
using ((select public.is_panel_owner()) and expires_at > now());
drop policy if exists owner_update on public.contact_requests;
create policy owner_update on public.contact_requests for update to authenticated
using ((select public.is_panel_owner()) and expires_at > now())
with check ((select public.is_panel_owner()) and expires_at > now());
drop policy if exists owner_delete on public.contact_requests;
create policy owner_delete on public.contact_requests for delete to authenticated
using ((select public.is_panel_owner()) and expires_at > now());

revoke all on public.contact_requests from public, anon, authenticated;
grant select, delete on public.contact_requests to authenticated;
grant update (status) on public.contact_requests to authenticated;

-- Única vía de entrada pública. No permite consultar, cambiar fechas ni asignar estados.
create or replace function public.submit_contact_request(
  p_id uuid, p_full_name text, p_phone text, p_email text,
  p_reasons text[], p_call_time text, p_comment text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  phone_clean text := regexp_replace(p_phone, '[^0-9+]', '', 'g');
begin
  if not exists (select 1 from private.panel_owners) then
    raise exception 'Panel not configured';
  end if;
  if p_id is null or p_full_name is null or p_phone is null or p_email is null
    or p_call_time is null or p_reasons is null
    or char_length(p_phone) > 30 or char_length(phone_clean) < 7
    or not (p_reasons <@ array['Organizar mis finanzas','Ahorro e inversión','Jubilación',
      'Vivienda o hipoteca','Seguros y protección','Mi negocio','Conocer el servicio','Otro motivo'])
    or array_position(p_reasons, null) is not null then
    raise exception 'Invalid request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(phone_clean, 0));
  -- Un reintento con el mismo identificador no duplica ni permite leer la solicitud.
  if exists (select 1 from public.contact_requests where id = p_id) then return true; end if;
  if (select count(*) from public.contact_requests
      where phone = phone_clean and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Too many requests';
  end if;
  insert into public.contact_requests (id, full_name, phone, email, reasons, call_time, comment)
  values (p_id, trim(p_full_name), phone_clean, lower(trim(p_email)), p_reasons,
    p_call_time, coalesce(trim(p_comment), ''));
  return true;
end;
$$;
revoke all on function public.submit_contact_request(uuid,text,text,text,text[],text,text) from public;
grant execute on function public.submit_contact_request(uuid,text,text,text,text[],text,text) to anon, authenticated;

-- Nunca exportar tablas de solicitudes al repositorio público ni a archivos estáticos.
commit;

-- Activar pg_cron en Supabase y ejecutar también estas instrucciones.
create extension if not exists pg_cron;
select cron.schedule(
  'portfolio-expired-requests',
  '* * * * *',
  $$delete from public.contact_requests where expires_at <= now()$$
);
