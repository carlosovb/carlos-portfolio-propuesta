-- Referencias de compañías en la misma consulta paginada. Conserva SECURITY INVOKER y RLS.
begin;
create or replace function public.list_my_clients(p_search text default '',p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare term text:=left(trim(coalesce(p_search,'')),120); result jsonb;
begin
 if not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>100000 then raise exception 'Invalid page'; end if;
 select jsonb_build_object('rows',coalesce((select jsonb_agg((to_jsonb(c)-'owner_id'-'identity_name') || jsonb_build_object(
     'companies',coalesce((select jsonb_agg(names.company order by names.company)
       from (select distinct trim(p.company) company from public.client_products p where p.client_id=c.id) names),'[]'::jsonb))) from
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


commit;
