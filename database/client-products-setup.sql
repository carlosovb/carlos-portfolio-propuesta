-- Productos contratados: cada consultor gestiona solo los de sus propios clientes.
begin;
create table if not exists public.client_products (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.portfolio_clients(id) on delete cascade,
 company text not null check(length(trim(company)) between 1 and 120),
 product text not null check(length(trim(product)) between 1 and 160),
 portfolio text not null default '' check(length(portfolio)<=160),
 payment_type text not null check(payment_type in ('monthly','single')),
 amount numeric not null check(amount>=0 and amount<=100000000 and round(amount,2)=amount),
 units numeric check(units>=0 and units<=100000000 and round(units,4)=units),
 created_at timestamptz not null default now()
);
create index if not exists client_products_client_date on public.client_products(client_id,created_at desc);
alter table public.client_products enable row level security;
revoke all on public.client_products from public,anon,authenticated;
grant select,delete on public.client_products to authenticated;
grant insert(id,client_id,company,product,portfolio,payment_type,amount,units) on public.client_products to authenticated;
grant update(company,product,portfolio,payment_type,amount,units) on public.client_products to authenticated;
drop policy if exists client_products_own_read on public.client_products;
create policy client_products_own_read on public.client_products for select to authenticated using(
 (select public.team_view_allowed()) and exists(select 1 from public.portfolio_clients c where c.id=client_id and c.owner_id=(select auth.uid()))
);
drop policy if exists client_products_own_insert on public.client_products;
create policy client_products_own_insert on public.client_products for insert to authenticated with check(
 (select public.team_view_allowed()) and exists(select 1 from public.portfolio_clients c where c.id=client_id and c.owner_id=(select auth.uid()))
);
drop policy if exists client_products_own_update on public.client_products;
create policy client_products_own_update on public.client_products for update to authenticated using(
 (select public.team_view_allowed()) and exists(select 1 from public.portfolio_clients c where c.id=client_id and c.owner_id=(select auth.uid()))
) with check(
 (select public.team_view_allowed()) and exists(select 1 from public.portfolio_clients c where c.id=client_id and c.owner_id=(select auth.uid()))
);
drop policy if exists client_products_own_delete on public.client_products;
create policy client_products_own_delete on public.client_products for delete to authenticated using(
 (select public.team_view_allowed()) and exists(select 1 from public.portfolio_clients c where c.id=client_id and c.owner_id=(select auth.uid()))
);
commit;
