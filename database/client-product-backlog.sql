begin;
create or replace function public.get_my_clients_without_products()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(c)-'owner_id'-'identity_name' order by c.last_name,c.first_name,c.id),'[]'::jsonb)
 from public.portfolio_clients c where c.owner_id=auth.uid() and c.is_active and c.deleted_at is null
 and public.client_category(c.client_type)='client' and not exists(select 1 from public.client_products p where p.client_id=c.id));
end; $$;
revoke all on function public.get_my_clients_without_products() from public,anon;
grant execute on function public.get_my_clients_without_products() to authenticated;
commit;
