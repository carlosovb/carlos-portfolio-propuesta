-- Clientes privados por consultor. No contiene datos del Excel ni ejemplos reales.
begin;

create or replace function public.client_identity_name(p_last_name text, p_first_name text)
returns text language sql immutable set search_path='' as $$
  select regexp_replace(lower(translate(coalesce(p_last_name,''),
    'ÁÀÄÂÃÅáàäâãåÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc')), '[^a-z0-9]', '', 'g') || ':' ||
    regexp_replace(lower(translate(coalesce(p_first_name,''),
    'ÁÀÄÂÃÅáàäâãåÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc')), '[^a-z0-9]', '', 'g');
$$;
revoke all on function public.client_identity_name(text,text) from public,anon;
grant execute on function public.client_identity_name(text,text) to authenticated;

create table if not exists public.portfolio_clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_type text not null default '' check(length(client_type)<=120),
  status text not null default '' check(length(status)<=120),
  last_name text not null default '' check(length(last_name)<=160),
  first_name text not null default '' check(length(first_name)<=120),
  email text not null default '' check(length(email)<=254),
  phone text not null default '' check(length(phone)<=80),
  birth_date date check(birth_date between date '1900-01-01' and date '2200-01-01'),
  street_type text not null default '' check(length(street_type)<=80),
  street text not null default '' check(length(street)<=240),
  street_number text not null default '' check(length(street_number)<=40),
  postal_code text not null default '' check(length(postal_code)<=20),
  locality text not null default '' check(length(locality)<=160),
  identity_name text generated always as (public.client_identity_name(last_name,first_name)) stored,
  created_at timestamptz not null default now(),
  check(length(public.client_identity_name(last_name,first_name))>=3),
  unique nulls not distinct(owner_id,identity_name,birth_date)
);
alter table public.portfolio_clients enable row level security;
revoke all on public.portfolio_clients from public,anon,authenticated;
grant select,delete on public.portfolio_clients to authenticated;
create index if not exists portfolio_clients_owner_name_idx on public.portfolio_clients(owner_id,last_name,first_name,id);
drop policy if exists portfolio_clients_own_read on public.portfolio_clients;
create policy portfolio_clients_own_read on public.portfolio_clients for select to authenticated
  using(owner_id=(select auth.uid()) and (select public.team_view_allowed()));
drop policy if exists portfolio_clients_own_delete on public.portfolio_clients;
create policy portfolio_clients_own_delete on public.portfolio_clients for delete to authenticated
  using(owner_id=(select auth.uid()) and (select public.team_view_allowed()));

-- Importación privilegiada necesaria para aplicar validación, propietario fijo y deduplicación atómica.
create or replace function public.import_my_clients(p_rows jsonb,p_preview boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); r jsonb; first_n text; last_n text; identity_n text; birthday date;
 key text; seen text[]:=array[]::text[]; inserted integer:=0; repeated integer:=0;
 invalid integer:=0; checked integer:=0; bad boolean; field text;
begin
 if uid is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_preview is null or p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Expected client array'; end if;
 if jsonb_array_length(p_rows)>5000 or octet_length(p_rows::text)>8000000 then raise exception 'Import too large'; end if;
 -- Dos importaciones simultáneas del mismo consultor no pueden crear duplicados.
 if not p_preview then perform pg_advisory_xact_lock(hashtextextended('portfolio_clients:'||uid::text,0)); end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  checked:=checked+1; birthday:=null; bad:=false;
  if jsonb_typeof(r)<>'object' then invalid:=invalid+1; continue; end if;
  foreach field in array array['client_type','status','last_name','first_name','email','phone','birth_date','street_type','street','street_number','postal_code','locality'] loop
   if r ? field and jsonb_typeof(r->field) not in ('string','null') then bad:=true; end if;
  end loop;
  first_n:=trim(coalesce(r->>'first_name','')); last_n:=trim(coalesce(r->>'last_name',''));
  identity_n:=public.client_identity_name(last_n,first_n);
  if length(identity_n)<3 or length(first_n)>120 or length(last_n)>160
    or length(coalesce(r->>'email',''))>254 or length(coalesce(r->>'phone',''))>80
    or length(coalesce(r->>'client_type',''))>120 or length(coalesce(r->>'status',''))>120
    or length(coalesce(r->>'street_type',''))>80 or length(coalesce(r->>'street',''))>240
    or length(coalesce(r->>'street_number',''))>40 or length(coalesce(r->>'postal_code',''))>20
    or length(coalesce(r->>'locality',''))>160 then bad:=true; end if;
  if nullif(trim(r->>'birth_date'),'') is not null then
   begin
    if (r->>'birth_date') !~ '^\d{4}-\d{2}-\d{2}$' then bad:=true;
    else birthday:=(r->>'birth_date')::date; end if;
    if birthday<date '1900-01-01' or birthday>current_date then bad:=true; end if;
   exception when invalid_datetime_format or datetime_field_overflow then bad:=true;
   end;
  end if;
  if bad then invalid:=invalid+1; continue; end if;
  key:=identity_n||'|'||coalesce(birthday::text,'');
  if key=any(seen) or (identity_n||'|')=any(seen) or
    (birthday is null and exists(select 1 from unnest(seen) s where split_part(s,'|',1)=identity_n)) or
    exists(select 1 from public.portfolio_clients c where c.owner_id=uid and c.identity_name=identity_n
      and (c.birth_date=birthday or c.birth_date is null or birthday is null)) then
   repeated:=repeated+1; continue;
  end if;
  seen:=array_append(seen,key);
  if not p_preview then
   insert into public.portfolio_clients(owner_id,client_type,status,last_name,first_name,email,phone,birth_date,
      street_type,street,street_number,postal_code,locality)
   values(uid,trim(coalesce(r->>'client_type','')),trim(coalesce(r->>'status','')),last_n,first_n,
      trim(coalesce(r->>'email','')),trim(coalesce(r->>'phone','')),birthday,
      trim(coalesce(r->>'street_type','')),trim(coalesce(r->>'street','')),trim(coalesce(r->>'street_number','')),
      trim(coalesce(r->>'postal_code','')),trim(coalesce(r->>'locality','')))
   on conflict do nothing;
   if not found then repeated:=repeated+1; continue; end if;
  end if;
  inserted:=inserted+1;
 end loop;
 return jsonb_build_object('received',checked,'added',inserted,'duplicates',repeated,'invalid',invalid,'preview',p_preview);
end;
$$;
revoke all on function public.import_my_clients(jsonb,boolean) from public,anon;
grant execute on function public.import_my_clients(jsonb,boolean) to authenticated;

create or replace function public.client_category(p_type text)
returns text language sql immutable set search_path='' as $$
 select case public.client_identity_name('',p_type)
  when ':cliente' then 'client' when ':interesado' then 'interested' else 'other' end;
$$;
revoke all on function public.client_category(text) from public,anon;
grant execute on function public.client_category(text) to authenticated;

create or replace function public.list_my_clients(p_search text default '',p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare term text:=left(trim(coalesce(p_search,'')),120); result jsonb;
begin
 if not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>100000 then raise exception 'Invalid page'; end if;
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(c)-'owner_id'-'identity_name') from
   (select *,public.client_category(client_type) as category from public.portfolio_clients where position(substr(public.client_identity_name('',term),2) in public.client_identity_name('',first_name||' '||last_name||' '||locality||' '||email||' '||phone))>0
    order by case public.client_category(client_type) when 'client' then 0 when 'interested' then 1 else 2 end,last_name,first_name,id limit 25 offset p_page*25) c),'[]'::jsonb),
   'total',(select count(*) from public.portfolio_clients where position(substr(public.client_identity_name('',term),2) in public.client_identity_name('',first_name||' '||last_name||' '||locality||' '||email||' '||phone))>0),
   'stats',(select jsonb_build_object('clients',count(*) filter(where public.client_category(client_type)='client'),'interested',count(*) filter(where public.client_category(client_type)='interested'),'localities',count(distinct nullif(lower(trim(locality)),'')),
      'records',count(*)) from public.portfolio_clients)) into result;
 return result;
end;
$$;
revoke all on function public.list_my_clients(text,integer) from public,anon;
grant execute on function public.list_my_clients(text,integer) to authenticated;

-- Únicamente recuentos asociados a los consultores visibles en el árbol; ningún campo de clientes.
create or replace function public.get_team_client_counts()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare directory jsonb; result jsonb;
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 directory:=public.get_team_directory();
 select jsonb_build_object('by_consultant',coalesce(jsonb_agg(jsonb_build_object('user_id',t.user_id,'clients',t.clients,'interested',t.interested)),'[]'::jsonb),
    'total',coalesce(sum(t.clients),0),'interested',coalesce(sum(t.interested),0),'consultants_with_clients',count(*) filter(where t.clients>0)) into result
 from (select (person->>'user_id')::uuid user_id,(select count(*) from public.portfolio_clients c where c.owner_id=(person->>'user_id')::uuid and public.client_category(c.client_type)='client') clients,
     (select count(*) from public.portfolio_clients c where c.owner_id=(person->>'user_id')::uuid and public.client_category(c.client_type)='interested') interested
   from jsonb_array_elements(directory) person) t;
 return result;
end;
$$;
revoke all on function public.get_team_client_counts() from public,anon;
grant execute on function public.get_team_client_counts() to authenticated;
commit;
