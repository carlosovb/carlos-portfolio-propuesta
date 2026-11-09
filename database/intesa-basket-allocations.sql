-- Conserva nombres y porcentajes de todas las cestas contratadas de Intesa.
begin;
alter table public.client_products
  drop constraint if exists client_products_portfolio_check,
  add constraint client_products_portfolio_check check (
    length(portfolio) <= case
      when company = 'Intesa Sanpaolo Assicurazioni' then 640
      else 160
    end
  );
commit;
