-- Las firmas nuevas y las ediciones explícitas de unidades deben declarar el valor.
-- Los registros históricos pendientes conservan sus datos y su ciclo de vida.
begin;
create or replace function private.guard_required_product_units()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.units is null then
    raise exception 'Introduce las unidades generadas' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_required_product_units() from public,anon,authenticated;
drop trigger if exists guard_required_product_units on public.client_products;
create trigger guard_required_product_units before insert or update of units
on public.client_products for each row execute function private.guard_required_product_units();
commit;
