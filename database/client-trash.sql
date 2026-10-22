-- Eliminación reversible durante 10 días. No modifica bajas ni firmas históricas.
begin;
alter table public.portfolio_clients add column if not exists deleted_at timestamptz;
create index if not exists portfolio_clients_deleted_at on public.portfolio_clients(deleted_at) where deleted_at is not null;

-- Conserva solo producción contable, sin nombres, contactos ni referencias al cliente.
create table if not exists private.deleted_product_production (
 product_id uuid primary key, producer uuid not null, signed_on date not null,
 units numeric not null, signed_multiplier numeric, signature_rates jsonb not null,
 preserved_at timestamptz not null default now()
);
alter table private.deleted_product_production enable row level security;
revoke all on private.deleted_product_production from public,anon,authenticated;
create or replace function private.preserve_deleted_production()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='portfolio_clients' then
   insert into private.deleted_product_production(product_id,producer,signed_on,units,signed_multiplier,signature_rates)
   select p.id,old.owner_id,p.signed_on,p.units,p.signed_multiplier,p.signature_rates from public.client_products p
   where p.client_id=old.id and p.signed_on is not null and p.units is not null on conflict(product_id) do nothing;
 else
   insert into private.deleted_product_production(product_id,producer,signed_on,units,signed_multiplier,signature_rates)
   select old.id,c.owner_id,old.signed_on,old.units,old.signed_multiplier,old.signature_rates from public.portfolio_clients c
   where c.id=old.client_id and old.signed_on is not null and old.units is not null on conflict(product_id) do nothing;
 end if;
 return old;
end; $$;
revoke all on function private.preserve_deleted_production() from public,anon,authenticated;
drop trigger if exists preserve_client_production on public.portfolio_clients;
create trigger preserve_client_production before delete on public.portfolio_clients for each row execute function private.preserve_deleted_production();
drop trigger if exists preserve_product_production on public.client_products;
create trigger preserve_product_production before delete on public.client_products for each row execute function private.preserve_deleted_production();
create or replace function private.prevent_reused_production_id()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.deleted_product_production where product_id=new.id) then raise exception 'Product identifier already used'; end if;
 return new;
end; $$;
revoke all on function private.prevent_reused_production_id() from public,anon,authenticated;
drop trigger if exists prevent_reused_production_id on public.client_products;
create trigger prevent_reused_production_id before insert on public.client_products for each row execute function private.prevent_reused_production_id();
create or replace function private.signature_commissions()
returns table(product_id uuid,producer uuid,beneficiary uuid,signed_on date,units numeric,euros numeric,is_own boolean)
language sql stable security definer set search_path='' as $$
 with production as (
 select p.id,c.owner_id producer,p.signed_on,p.units,p.signed_multiplier,p.signature_rates
 from public.client_products p join public.portfolio_clients c on c.id=p.client_id
 union all select h.product_id,h.producer,h.signed_on,h.units,h.signed_multiplier,h.signature_rates from private.deleted_product_production h
 )
 select p.id,p.producer,p.producer,p.signed_on,p.units,round(p.units*p.signed_multiplier,2),true from production p
 where p.signed_on<=(now() at time zone 'Atlantic/Canary')::date and p.units is not null
 union all
 select p.id,p.producer,k.key::uuid,p.signed_on,p.units,
 case when p.signed_multiplier is null or k.value='null'::jsonb then null
 else round(p.units*greatest((k.value::text)::numeric-p.signed_multiplier,0),2) end,false
 from production p cross join lateral jsonb_each(p.signature_rates) k
 where p.signed_on<=(now() at time zone 'Atlantic/Canary')::date and p.units is not null;
$$;
revoke all on function private.signature_commissions() from public,anon,authenticated;

revoke delete on public.portfolio_clients from authenticated;
drop policy if exists portfolio_clients_not_deleted on public.portfolio_clients;
create policy portfolio_clients_not_deleted on public.portfolio_clients as restrictive for select to authenticated using(deleted_at is null);

create or replace function public.trash_my_clients(p_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_ids is null or cardinality(p_ids) not between 1 and 25 then raise exception 'Invalid selection'; end if;
 update public.portfolio_clients set deleted_at=clock_timestamp()
 where id=any(p_ids) and owner_id=auth.uid() and deleted_at is null;
 get diagnostics affected=row_count;
 return affected;
end; $$;

create or replace function public.list_deleted_clients(p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; admin boolean;
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_page is null or p_page not between 0 and 100000 then raise exception 'Invalid page'; end if;
 admin:=public.is_panel_owner();
 select jsonb_build_object('admin',admin,'total',(select count(*) from public.portfolio_clients c where c.deleted_at is not null and (c.owner_id=auth.uid() or admin)),
 'rows',coalesce(jsonb_agg(to_jsonb(r)),'[]')) into result from (
 select c.id,c.first_name,c.last_name,c.deleted_at,c.deleted_at+interval '10 days' as purge_at,
 c.deleted_at+interval '10 days'>statement_timestamp() as recoverable
 from public.portfolio_clients c where c.deleted_at is not null and (c.owner_id=auth.uid() or admin)
 order by c.deleted_at desc,c.id limit 25 offset p_page*25
 ) r;
 return result;
end; $$;

create or replace function public.restore_deleted_client(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 update public.portfolio_clients set deleted_at=null where id=p_id and (owner_id=auth.uid() or public.is_panel_owner())
 and deleted_at is not null and deleted_at+interval '10 days'>clock_timestamp();
 if not found then raise exception 'Client unavailable or recovery period expired' using errcode='42501'; end if;
end; $$;

create or replace function public.purge_deleted_client(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.team_view_allowed() or not public.is_panel_owner() then raise exception 'Administrator required' using errcode='42501'; end if;
 delete from public.portfolio_clients where id=p_id and deleted_at is not null;
 if not found then raise exception 'Client unavailable' using errcode='42501'; end if;
end; $$;

revoke all on function public.trash_my_clients(uuid[]),public.list_deleted_clients(integer),public.restore_deleted_client(uuid),public.purge_deleted_client(uuid) from public,anon;
grant execute on function public.trash_my_clients(uuid[]),public.list_deleted_clients(integer),public.restore_deleted_client(uuid),public.purge_deleted_client(uuid) to authenticated;
create or replace function public.get_team_client_counts()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare directory jsonb; result jsonb;
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 directory:=public.get_team_directory();
 select jsonb_build_object('by_consultant',coalesce(jsonb_agg(jsonb_build_object('user_id',t.user_id,'clients',t.clients,'interested',t.interested)),'[]'::jsonb),
    'total',coalesce(sum(t.clients),0),'interested',coalesce(sum(t.interested),0),'consultants_with_clients',count(*) filter(where t.clients>0)) into result
 from (select (person->>'user_id')::uuid user_id,(select count(*) from public.portfolio_clients c where c.owner_id=(person->>'user_id')::uuid and c.deleted_at is null and public.client_category(c.client_type)='client') clients,
     (select count(*) from public.portfolio_clients c where c.owner_id=(person->>'user_id')::uuid and c.deleted_at is null and public.client_category(c.client_type)='interested') interested
   from jsonb_array_elements(directory) person) t;
 return result;
end;
$$;
revoke all on function public.get_team_client_counts() from public,anon;
grant execute on function public.get_team_client_counts() to authenticated;

commit;

-- Limpieza al vencer el plazo. El primer ciclo posterior al vencimiento elimina el registro.
create extension if not exists pg_cron;
select cron.schedule('portfolio-deleted-clients','* * * * *',
 $$delete from public.portfolio_clients where deleted_at <= now()-interval '10 days'$$);
