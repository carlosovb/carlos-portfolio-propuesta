-- Devuelve solo los clientes insertados en este lote para configurar sus productos.
begin;
create or replace function public.import_my_clients(p_rows jsonb,p_preview boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); r jsonb; first_n text; last_n text; identity_n text; birthday date;
 key text; seen text[]:=array[]::text[]; inserted integer:=0; repeated integer:=0;
 invalid integer:=0; checked integer:=0; bad boolean; field text;
 saved public.portfolio_clients%rowtype; new_clients jsonb:='[]'::jsonb;
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
   on conflict do nothing returning * into saved;
   if not found then repeated:=repeated+1; continue; end if;
   if public.client_category(saved.client_type)='client' then
     new_clients:=new_clients||jsonb_build_array(to_jsonb(saved)-'owner_id'-'identity_name');
   end if;
  end if;
  inserted:=inserted+1;
 end loop;
 return jsonb_build_object('received',checked,'added',inserted,'duplicates',repeated,'invalid',invalid,'preview',p_preview)||case when p_preview then '{}'::jsonb else jsonb_build_object('new_clients',new_clients) end;
end;
$$;
revoke all on function public.import_my_clients(jsonb,boolean) from public,anon;
grant execute on function public.import_my_clients(jsonb,boolean) to authenticated;


commit;
