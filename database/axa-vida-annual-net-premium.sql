-- Aplicar después de axa-vida-protect.sql.
begin;
alter table public.client_products add column if not exists life_annual_net_premium numeric;
grant insert(life_annual_net_premium), update(life_annual_net_premium)
  on public.client_products to authenticated;
alter table public.client_products
  add constraint client_products_life_annual_net_premium_check check (
    life_annual_net_premium is null or (
      lower(trim(company))='axa' and lower(trim(product))='vida protect' and not is_apex
      and payment_type in ('monthly','quarterly','semiannual','annual')
      and life_annual_net_premium between 0.01 and 100000000
      and round(life_annual_net_premium,2)=life_annual_net_premium
      and amount=round(life_annual_net_premium /
        case payment_type when 'monthly' then 12 when 'quarterly' then 4 when 'semiannual' then 2 else 1 end, 2)
    )
  );
commit;
