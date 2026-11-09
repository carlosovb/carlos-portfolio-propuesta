-- Promociones solicitadas y resueltas por el responsable directo.
begin;
create table if not exists private.career_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_code text not null references public.team_roles(code),
  target_code text not null references public.team_roles(code),
  quarter_start date not null,
  quarters integer not null check (quarters in (1,2)),
  status text not null default 'requested',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
alter table private.career_requests enable row level security;
revoke all on private.career_requests from public,anon,authenticated;
alter table private.career_requests add column if not exists decision_note text;
alter table private.career_requests add column if not exists review_snapshot jsonb;
alter table private.career_requests drop constraint if exists career_requests_status_check;
alter table private.career_requests add constraint career_requests_status_check
  check (status in ('requested','tracking','completed','cancelled','denied','unsuccessful'));
create unique index if not exists career_request_open
  on private.career_requests(user_id) where status in ('requested','tracking');

create or replace function private.career_period_start(day date, quarters integer)
returns date language sql immutable set search_path='' as $$
  select (date_trunc('year',day::timestamp)+make_interval(
    months=>((extract(month from day)::integer-1)/(3*quarters)+1)*3*quarters
  ))::date;
$$;

create or replace function private.career_request_targets(p_user uuid)
returns text[] language plpgsql stable set search_path='' as $$
declare assignment private.team_assignments%rowtype; progress jsonb;
  current_quarter date:=date_trunc('quarter',now() at time zone 'Atlantic/Canary')::date;
  previous_quarter_minimum numeric;
begin
  select * into assignment from private.team_assignments where user_id=p_user;
  if assignment.manager_id is null or assignment.position_code in ('financial_trainee','national_director')
    then return array[]::text[]; end if;
  progress:=public.get_career_progress(p_user);
  if assignment.position_code in ('financial_consultant','financial_consultant_senior_i') then
    select least(
      coalesce(sum(units) filter(where signed_on<current_quarter-interval '3 months'),0),
      coalesce(sum(units) filter(where signed_on>=current_quarter-interval '3 months'),0)
    ) into previous_quarter_minimum
    from private.signature_commissions()
    where beneficiary=p_user and is_own
      and signed_on>=current_quarter-interval '6 months' and signed_on<current_quarter;
  end if;
  -- Requisitos cuantificables del plan. Para GE, se combinan FT y FC directos.
  return coalesce((
    select array_agg(distinct target order by target)
    from (values
      ('financial_consultant','financial_consultant_senior_i',6000,1000,null,0,false),
      ('financial_consultant_senior_i','financial_consultant_senior_ii',25000,2000,null,0,false),
      ('financial_consultant','team_manager',4000,0,'financial_consultant',3,true),
      ('team_manager','zone_coordinator',0,0,'team_manager',2,false),
      ('team_manager','zone_coordinator',0,0,'financial_consultant',4,false),
      ('zone_coordinator','agency_director',0,0,'team_manager',5,false),
      ('zone_coordinator','agency_director',0,0,'financial_consultant',9,false),
      ('agency_director','regional_director',0,0,'zone_coordinator',3,false),
      ('regional_director','national_director',0,0,'agency_director',3,false),
      ('regional_director','national_director',0,0,'zone_coordinator',5,false)
    ) r(origin,target,historical,prior_quarter,team_role,team_count,direct)
    where origin=assignment.position_code
      and (target<>'team_manager' or exists (
        select 1 from public.consultant_profiles p where p.user_id=p_user
        and p.consultant_since+interval '9 months'<=(now() at time zone 'Atlantic/Canary')::date
      ))
      and coalesce((progress#>>'{production,historical}')::numeric,0)>=historical
      and coalesce(previous_quarter_minimum,0)>=prior_quarter
      and (team_count=0 or case when direct then (
        select count(*) from jsonb_array_elements(public.get_team_directory()) d
        where (d->>'manager_id')::uuid=p_user
          and (d->>'position_code'=team_role or (target='team_manager' and d->>'position_code'='financial_trainee'))
      ) else coalesce((progress->'counts'->>team_role)::integer,0) end>=team_count)
  ),array[]::text[]);
end;
$$;
revoke all on function private.career_period_start(date,integer),private.career_request_targets(uuid) from public,anon,authenticated;

create or replace function private.career_quarter_checks(p_user uuid,p_target text,p_start date,p_quarters integer)
returns jsonb language sql stable set search_path='' as $$
  with rule as (
    select *
    from (values
      ('financial_consultant_senior_i',1000,null,true,0),
      ('financial_consultant_senior_ii',2000,null,true,0),
      ('team_manager',null,null,false,0),
      ('zone_coordinator',9000,11250,false,6000),
      ('agency_director',25000,31250,false,9000),
      ('regional_director',60000,75000,false,0),
      ('national_director',120000,150000,false,0)
    ) r(target,minimum,alternative,own_only,historical_minimum)
    where r.target=p_target
  ), active_rules as (
    select *
    from (values
      ('financial_trainee',null,true),
      ('financial_consultant',300,true),
      ('financial_consultant_senior_i',1000,true),
      ('financial_consultant_senior_ii',2000,true),
      ('team_manager',1200,false),
      ('zone_coordinator',3600,false),
      ('agency_director',10000,false),
      ('regional_director',24000,false),
      ('national_director',48000,false)
    ) r(position,minimum,own_only)
  ), collaborators as (
    select a.user_id, a.position_code, concat_ws(' ',p.first_name,p.last_name) name
    from private.team_assignments a join public.consultant_profiles p on p.user_id=a.user_id
    where a.manager_id=p_user
      and case p_target
        when 'team_manager' then a.position_code in ('financial_trainee','financial_consultant')
        when 'zone_coordinator' then a.position_code in ('team_manager','financial_consultant','financial_consultant_senior_i','financial_consultant_senior_ii')
        when 'agency_director' then a.position_code in ('team_manager','financial_consultant','financial_consultant_senior_i','financial_consultant_senior_ii')
        when 'regional_director' then a.position_code in ('zone_coordinator','team_manager')
        when 'national_director' then a.position_code in ('agency_director','zone_coordinator','team_manager')
        else false end
  ), periods as (
    select q.start::date start, (q.start+interval '3 months')::date ends_on
    from rule r cross join lateral generate_series(
      p_start+case when r.own_only then interval '-6 months' else interval '0 months' end,
      p_start+case when r.own_only then interval '-3 months' else make_interval(months=>3*(p_quarters-1)) end,
      interval '3 months'
    ) q(start)
  ), production as (
    select s.beneficiary, date_trunc('quarter',s.signed_on::timestamp)::date start,
      sum(s.units) filter(where s.is_own) own, sum(s.units) total
    from private.signature_commissions() s
    where (s.beneficiary=p_user or s.beneficiary in (select user_id from collaborators))
      and s.signed_on >= (select min(start) from periods)
      and s.signed_on < (select max(ends_on) from periods)
    group by s.beneficiary,date_trunc('quarter',s.signed_on::timestamp)::date
  ), historical as (
    select coalesce(sum(s.units),0) recorded
    from rule r cross join private.signature_commissions() s
    where r.historical_minimum>0 and s.beneficiary=p_user and s.is_own
      and s.signed_on<p_start+make_interval(months=>3*p_quarters)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'start',q.start,'ends_on',q.ends_on,'own_only',r.own_only,'minimum',r.minimum,
    'alternative',r.alternative,'recorded',coalesce(case when r.own_only then u.own else u.total end,0),
    'historical',case when r.historical_minimum>0 and q.ends_on=p_start+make_interval(months=>3*p_quarters)
      then jsonb_build_object('minimum',r.historical_minimum,'recorded',h.recorded) end,
    'collaborators',coalesce((
      select jsonb_agg(jsonb_build_object('name',c.name,'position',c.position_code,
        'minimum',a.minimum,'own_only',a.own_only,
        'recorded',coalesce(case when a.own_only then v.own else v.total end,0)) order by c.name,c.user_id)
      from collaborators c join active_rules a on a.position=c.position_code
      left join production v on v.beneficiary=c.user_id and v.start=q.start
    ),'[]'::jsonb)
  ) order by q.start),'[]'::jsonb)
  from periods q cross join rule r cross join historical h
  left join production u on u.beneficiary=p_user and u.start=q.start;
$$;
revoke all on function private.career_quarter_checks(uuid,text,date,integer) from public,anon,authenticated;

create or replace function public.list_career_requests()
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); today date:=(now() at time zone 'Atlantic/Canary')::date;
begin
  if uid is null or not public.team_view_allowed() then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
  perform private.emit_panel_event(uid,null,'career.review_due','Promoción pendiente de resolución',
    concat_ws(' ',p.first_name,p.last_name)||' ha completado su periodo de seguimiento.',
    'career_request',c.id,'career-due:'||c.id::text,now(),true)
  from private.career_requests c
  join private.team_assignments a on a.user_id=c.user_id and a.manager_id=uid
  join public.consultant_profiles p on p.user_id=c.user_id
  where c.status='tracking' and today>=c.quarter_start+make_interval(months=>3*c.quarters);
  return jsonb_build_object(
    'today',today,
    'targets',case when exists(select 1 from private.career_requests
      where user_id=uid and status in ('requested','tracking')) then '[]'::jsonb
      else to_jsonb(private.career_request_targets(uid)) end,
    'rows',coalesce((
      select jsonb_agg(to_jsonb(r) order by r.requested_at desc) from (
        select c.id,c.user_id=uid is_own,a.manager_id=uid can_review,c.status,c.target_code,
          c.quarter_start,c.requested_at,c.decision_note,
          concat_ws(' ',p.first_name,p.last_name) consultant,
          (c.quarter_start+make_interval(months=>3*c.quarters))::date ends_on,
          case when c.status in ('tracking','completed','unsuccessful') then
            coalesce(c.review_snapshot,private.career_quarter_checks(c.user_id,c.target_code,c.quarter_start,c.quarters))
          else '[]'::jsonb end quarter_checks,
          coalesce((
            select jsonb_agg(jsonb_build_object('start',m.start::date,
              'own',coalesce(u.own,0),'team',coalesce(u.team,0)) order by m.start)
            from generate_series(c.quarter_start::timestamp,
              c.quarter_start+make_interval(months=>3*c.quarters-1),interval '1 month') m(start)
            left join lateral (
              select sum(s.units) filter(where s.is_own) own,sum(s.units) filter(where not s.is_own) team
              from private.signature_commissions() s
              where s.beneficiary=c.user_id and s.signed_on>=m.start and s.signed_on<m.start+interval '1 month'
            ) u on true
            where c.status in ('tracking','completed','unsuccessful')
          ),'[]'::jsonb) progress
        from private.career_requests c
        join private.team_assignments a on a.user_id=c.user_id
        join public.consultant_profiles p on p.user_id=c.user_id
        where c.user_id=uid or a.manager_id=uid
        order by c.requested_at desc limit 100
      ) r
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.request_career_promotion(p_target text)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); assignment private.team_assignments%rowtype;
  request_id uuid; duration integer; consultant text;
begin
  if uid is null or not public.team_view_allowed() then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
  select * into assignment from private.team_assignments where user_id=uid for update;
  if p_target is null or not (p_target=any(private.career_request_targets(uid))) then
    raise exception 'Aún no se cumplen los requisitos para esta promoción';
  end if;
  duration:=case when p_target='team_manager' then 1 else 2 end;
  insert into private.career_requests(user_id,from_code,target_code,quarter_start,quarters)
  values(uid,assignment.position_code,p_target,private.career_period_start((now() at time zone 'Atlantic/Canary')::date,duration),duration)
  returning id into request_id;
  select concat_ws(' ',first_name,last_name) into consultant from public.consultant_profiles where user_id=uid;
  perform private.emit_panel_event(assignment.manager_id,null,'career.requested','Nueva solicitud de promoción',
    consultant||' solicita entrar en promoción.','career_request',request_id,'career-requested:'||request_id::text,now(),true);
  return request_id;
end;
$$;

drop function if exists public.review_career_request(uuid,text);
create or replace function public.review_career_request(p_id uuid,p_action text,p_note text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare request private.career_requests%rowtype; assignment private.team_assignments%rowtype;
  role_label text; result text; message text;
  today date:=(now() at time zone 'Atlantic/Canary')::date;
begin
  if auth.uid() is null or not public.team_view_allowed() then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
  select * into request from private.career_requests where id=p_id for update;
  if not found then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
  select * into assignment from private.team_assignments where user_id=request.user_id for update;
  if not found or (case when p_action='cancel' then request.user_id else assignment.manager_id end) is distinct from auth.uid()
    then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
  p_note:=nullif(trim(p_note),'');
  if p_action in ('deny','reject') and (p_note is null or char_length(p_note)>500)
    then raise exception 'Indica un motivo de hasta 500 caracteres'; end if;
  if p_action='cancel' and request.status in ('requested','tracking')
      and (request.status='requested' or today<request.quarter_start+make_interval(months=>3*request.quarters)) then
    result:='cancelled';
  elsif p_action='approve' and request.status='requested' then
    if assignment.position_code is distinct from request.from_code then
      raise exception 'El puesto del consultor ha cambiado';
    end if;
    result:='tracking'; message:='Tu entrada en promoción ha sido aprobada';
    request.quarter_start:=greatest(request.quarter_start,private.career_period_start(today,request.quarters));
  elsif p_action='deny' and request.status='requested' then
    result:='denied'; message:='Tu entrada en promoción no ha sido aprobada';
  elsif p_action in ('complete','reject') and request.status='tracking'
      and today>=request.quarter_start+make_interval(months=>3*request.quarters) then
    if p_action='complete' then
      update private.team_assignments set position_code=request.target_code,updated_at=now()
        where user_id=request.user_id and position_code=request.from_code;
      if not found then raise exception 'El puesto del consultor ha cambiado'; end if;
      result:='completed';
      select label into role_label from public.team_roles where code=request.target_code;
      perform private.record_career_trophy(request.user_id,p_id,request.target_code);
      perform private.emit_panel_event(request.user_id,null,'career_promotion','¡Enhorabuena por tu ascenso!',
        'Has ascendido a '||role_label||'.','career_promotion',p_id,'career-request:'||p_id::text,now(),true);
    else
      result:='unsuccessful'; message:='El ascenso no ha sido concedido';
    end if;
  else
    raise exception 'La promoción no está en el estado o periodo adecuado';
  end if;
  update private.career_requests set status=result,quarter_start=request.quarter_start,
    decision_note=case when result in ('denied','unsuccessful') then p_note end,
    review_snapshot=case when result in ('completed','unsuccessful') then
      private.career_quarter_checks(request.user_id,request.target_code,request.quarter_start,request.quarters)
    end,
    reviewed_by=auth.uid(),reviewed_at=now() where id=p_id;
  if message is not null then
    perform private.emit_panel_event(request.user_id,null,'career.decision',message,coalesce(p_note,'Consulta los detalles en Mis promociones.'),
      'career_request',p_id,'career-decision:'||p_id::text||':'||result,now(),true);
  end if;
  return true;
end;
$$;
revoke all on function public.list_career_requests(),public.request_career_promotion(text),public.review_career_request(uuid,text,text) from public,anon;
grant execute on function public.list_career_requests(),public.request_career_promotion(text),public.review_career_request(uuid,text,text) to authenticated;
commit;
