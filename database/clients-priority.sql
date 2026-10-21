begin;
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
