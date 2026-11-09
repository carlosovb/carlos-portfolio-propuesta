-- TOP10: periodicidad y prima inicial calculable, sin generar una firma adicional.
begin;
alter table public.client_products
  drop constraint if exists client_products_payment_type_check,
  add constraint client_products_payment_type_check check (
    payment_type in ('monthly','single') or (
      payment_type in ('quarterly','annual') and not is_apex
        and regexp_replace(lower(company),'[^a-z0-9]','','g') like 'intesasanpaolo%'
        and regexp_replace(lower(product),'[^a-z0-9]','','g')='top10'
    )
  );

create or replace function private.guard_top10_periodic_payment()
returns trigger language plpgsql set search_path='' as $$
declare payments integer;
begin
  if new.is_apex or regexp_replace(lower(new.company),'[^a-z0-9]','','g') not like 'intesasanpaolo%'
    or regexp_replace(lower(new.product),'[^a-z0-9]','','g')<>'top10' then return new; end if;
  if tg_op='UPDATE' and (new.company,new.product,new.payment_type,new.amount)
      is not distinct from (old.company,old.product,old.payment_type,old.amount) then return new; end if;
  payments:=case new.payment_type when 'monthly' then 12 when 'quarterly' then 4 when 'annual' then 1 end;
  if payments is null or new.amount*payments not between 600 and 12000 then
    raise exception 'TOP10 requires periodic contributions of 600 to 12000 EUR per year';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_top10_periodic_payment() from public,anon,authenticated;
drop trigger if exists guard_top10_periodic_payment on public.client_products;
create trigger guard_top10_periodic_payment before insert or update of company,product,payment_type,amount
on public.client_products for each row execute function private.guard_top10_periodic_payment();

create or replace function private.track_product_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare item public.client_products%rowtype; owner uuid; title text; kind text;
begin
 if tg_op='DELETE' then item:=old;else item:=new;end if;
 select owner_id into owner from public.portfolio_clients where id=item.client_id;
 if owner is null then return coalesce(new,old);end if;
 if tg_op='INSERT' then title:=case when item.is_apex then 'APEX registrada' else 'Producto contratado registrado' end;kind:='product.created';
 elsif tg_op='DELETE' then title:='Producto eliminado · producción conservada';kind:='product.deleted';
 elsif to_jsonb(new) is not distinct from to_jsonb(old) then return new;
 elsif new.archived_at is distinct from old.archived_at then title:=case when new.archived_at is null then 'Producto reactivado' else 'Producto pasado al historial' end;kind:='product.archived';
 else title:='Producto actualizado';kind:='product.updated';end if;
 perform private.emit_panel_event(owner,item.client_id,kind,title,
 item.company||' · '||item.product||' · '||item.portfolio||' · '||item.amount::text||case item.payment_type when 'monthly' then ' €/mes' when 'quarterly' then ' €/trimestre' when 'annual' then ' €/año' else ' € · aportación única' end||coalesce(' · '||item.units::text||' U','')||coalesce(' · Firma: '||item.signed_on::text,''),
 'client',item.client_id,case when tg_op='INSERT' then 'product-created:'||item.id::text else null end,case when tg_op='INSERT' then item.created_at else now() end);
 return coalesce(new,old);
end; $$;
revoke all on function private.track_product_event() from public,anon,authenticated;
commit;
