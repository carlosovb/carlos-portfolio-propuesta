-- Pausa de emergencia después de aplicar las migraciones de la v0.7.0.
-- Se mantienen las firmas, sus tramos y la función que calcula las comisiones.
begin;
drop trigger if exists promote_on_signature on public.client_products;
create trigger promote_on_signature after insert or update of signed_on,units,signed_multiplier
on public.client_products for each row execute function private.promote_on_signature('paused');
revoke execute on function public.request_career_promotion(text),
  public.review_career_request(uuid,text,text),public.list_career_requests(),
  public.update_resource(uuid,text,text,text) from authenticated;
commit;
