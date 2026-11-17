-- Pausa de la automatización. Conserva puestos, trofeos, tramos y comisiones ya registrados.
begin;
drop trigger if exists promote_on_life_installment on public.client_products;
do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname='portfolio-life-promotions';
  end if;
end; $$;
commit;
