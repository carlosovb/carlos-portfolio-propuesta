-- Periodos completos inclusivos por mes. Mantiene intacta la consulta mensual existente.
begin;
create or replace function public.get_unit_statistics_range(p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; start_day date:=date_trunc('month',p_from)::date; end_day date; today date:=(now() at time zone 'Atlantic/Canary')::date;
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from<date '2000-01-01' or p_to<date '2000-01-01' or p_from>today or p_to>today or date_trunc('month',p_from)>date_trunc('month',p_to) then raise exception 'Invalid month range'; end if;
 end_day:=(date_trunc('month',p_to)+interval '1 month')::date;
 with recursive permitted as (
   select auth.uid() user_id union select a.user_id from private.team_assignments a join permitted b on a.manager_id=b.user_id
 ), source as (select * from private.signature_commissions() where signed_on>=start_day and signed_on<end_day),
 scopes as (
   select 'own' scope,s.* from source s where beneficiary=auth.uid() and is_own
   union all select 'team',s.* from source s where beneficiary=auth.uid() and not is_own
   union all select 'global',s.* from source s
 ), summary as (
   select scope,jsonb_build_object(
    'units',coalesce(sum(units) filter(where is_own or scope<>'global'),0),
    'own_units',coalesce(sum(units) filter(where is_own),0),
    'team_units',coalesce(sum(units) filter(where not is_own),0),
    'own_euros',coalesce(sum(euros) filter(where is_own),0),
    'team_euros',coalesce(sum(euros) filter(where not is_own),0),
    'pending',count(*) filter(where euros is null)) value from scopes group by scope
 ), days as (
   select scope,signed_on,jsonb_build_object('date',signed_on,'day',extract(day from signed_on),'units',coalesce(sum(units) filter(where is_own or scope<>'global'),0),'euros',coalesce(sum(euros),0),'own_units',coalesce(sum(units) filter(where is_own),0),'team_units',coalesce(sum(units) filter(where not is_own),0),'own_euros',coalesce(sum(euros) filter(where is_own),0),'team_euros',coalesce(sum(euros) filter(where not is_own),0),'pending',count(*) filter(where euros is null)) value
   from scopes group by scope,signed_on
 ), months as (
   select scope,date_trunc('month',signed_on)::date month_start,jsonb_build_object('month',date_trunc('month',signed_on)::date,'units',coalesce(sum(units) filter(where is_own or scope<>'global'),0),'euros',coalesce(sum(euros),0),'own_units',coalesce(sum(units) filter(where is_own),0),'team_units',coalesce(sum(units) filter(where not is_own),0),'own_euros',coalesce(sum(euros) filter(where is_own),0),'team_euros',coalesce(sum(euros) filter(where not is_own),0),'pending',count(*) filter(where euros is null)) value
   from scopes group by scope,date_trunc('month',signed_on)
 ), people as (
   select b.user_id,p.first_name||' '||p.last_name name,
    coalesce(sum(s.units) filter(where s.is_own),0) own_units,
    coalesce(sum(s.euros) filter(where s.is_own),0) own_euros,
    coalesce(sum(s.units) filter(where not s.is_own),0) team_units,
    coalesce(sum(s.euros) filter(where not s.is_own),0) team_euros,
    count(s.product_id) filter(where s.euros is null) pending
   from permitted b join public.consultant_profiles p on p.user_id=b.user_id
   left join source s on s.beneficiary=b.user_id group by b.user_id,p.first_name,p.last_name
 ) select jsonb_build_object(
   'month',start_day,'from_month',start_day,'to_month',(end_day-interval '1 month')::date,'last_day',extract(day from end_day-1),
   'first_month',coalesce((select date_trunc('month',min(signed_on))::date from private.signature_commissions()),date_trunc('month',today)::date),
   'scopes',coalesce((select jsonb_object_agg(scope,value) from summary),'{}'::jsonb),
   'days',coalesce((select jsonb_object_agg(scope,items) from (select scope,jsonb_agg(value order by signed_on) items from days group by scope) d),'{}'::jsonb),
   'months',coalesce((select jsonb_object_agg(scope,items) from (select scope,jsonb_agg(value order by month_start) items from months group by scope) m),'{}'::jsonb),
   'people',coalesce((select jsonb_agg(to_jsonb(p) order by name) from people p),'[]'::jsonb),
   'incomplete_team',(select count(*) from public.client_products p join public.portfolio_clients c on c.id=p.client_id where c.owner_id in(select user_id from permitted where user_id<>auth.uid()) and (p.signed_on is null or p.units is null)),
   'undated_own',(select count(*) from public.client_products p join public.portfolio_clients c on c.id=p.client_id where c.owner_id=auth.uid() and (p.signed_on is null or p.units is null)),
   'incomplete_global',(select count(*) from public.client_products where signed_on is null or units is null)
 ) into result;
 return result;
end; $$;
revoke all on function public.get_unit_statistics_range(date,date) from public,anon;
grant execute on function public.get_unit_statistics_range(date,date) to authenticated;

commit;
