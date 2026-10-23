begin;
create table if not exists private.consultant_invitations(
 email text primary key, inviter_id uuid not null references auth.users(id) on delete cascade,
 user_id uuid unique references auth.users(id) on delete cascade, created_at timestamptz not null default now()
);
alter table private.consultant_invitations enable row level security;
revoke all on private.consultant_invitations from public,anon,authenticated;
create or replace function public.prepare_consultant_invitation(p_email text)
returns boolean language plpgsql security definer set search_path='' as $$
declare clean_email text:=lower(trim(p_email)); target auth.users%rowtype; reservation private.consultant_invitations%rowtype;
begin
 if auth.uid() is null or not public.team_view_allowed() then raise exception 'Not authorized' using errcode='42501'; end if;
 if clean_email is null or length(clean_email)>254 or clean_email !~ '^[^[:space:]@]+@ovb\.es$' then return false; end if;
 select * into target from auth.users where lower(email)=clean_email;
 if found then
  if target.invited_at is null or exists(select 1 from public.consultant_profiles where user_id=target.id)
   or exists(select 1 from private.panel_owners where user_id=target.id) then return false; end if;
  if not public.is_panel_owner() and not exists(select 1 from private.consultant_invitations where user_id=target.id and inviter_id=auth.uid()) then return false; end if;
 end if;
 insert into private.consultant_invitations(email,inviter_id) values(clean_email,auth.uid()) on conflict do nothing;
 select * into reservation from private.consultant_invitations where email=clean_email for update;
 return reservation.inviter_id=auth.uid();
end; $$;
create or replace function public.record_consultant_invitation(p_user uuid,p_inviter uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare target auth.users%rowtype; reservation private.consultant_invitations%rowtype;
begin
 if p_user=p_inviter or not exists(select 1 from public.consultant_profiles p where p.user_id=p_inviter
  and (exists(select 1 from private.panel_owners where user_id=p_inviter) or exists(select 1 from private.panel_members where user_id=p_inviter and enabled and password_set_at is not null))) then return false; end if;
 select * into target from auth.users where id=p_user for update;
 if not found or target.invited_at is null or exists(select 1 from public.consultant_profiles where user_id=p_user)
  or exists(select 1 from private.panel_owners where user_id=p_user) then return false; end if;
 select * into reservation from private.consultant_invitations where email=lower(target.email) for update;
 if not found or reservation.inviter_id<>p_inviter or (reservation.user_id is not null and reservation.user_id<>p_user) then return false; end if;
 if exists(with recursive ancestors as (
  select a.user_id,a.manager_id,array[a.user_id] as visited from private.team_assignments a where a.user_id=p_inviter
  union all select a.user_id,a.manager_id,c.visited||a.user_id from private.team_assignments a join ancestors c on a.user_id=c.manager_id where not a.user_id=any(c.visited)
 ) select 1 from ancestors where user_id=p_user) then return false; end if;
 update private.consultant_invitations set user_id=p_user where email=lower(target.email);
 insert into private.team_assignments(user_id,manager_id) values(p_user,p_inviter)
 on conflict(user_id) do update set manager_id=excluded.manager_id;
 return true;
end; $$;
revoke all on function public.record_consultant_invitation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_consultant_invitation(uuid,uuid) to service_role;
revoke all on function public.prepare_consultant_invitation(text) from public,anon;
grant execute on function public.prepare_consultant_invitation(text) to authenticated;
create or replace function public.list_consultants()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.team_view_allowed() then raise exception 'Not authorized'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
 'user_id',u.id,'can_delete',u.invited_at is not null and (m.password_set_at is null or p.user_id is null),
 'email',u.email,'name',nullif(trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),''),
 'enabled',m.enabled,'complete',p.user_id is not null and m.password_set_at is not null) order by u.created_at desc)
 from private.panel_members m join auth.users u on u.id=m.user_id left join public.consultant_profiles p on p.user_id=m.user_id
 where not exists(select 1 from private.panel_owners where user_id=m.user_id)
 and (public.is_panel_owner() or exists(select 1 from private.consultant_invitations i where i.user_id=u.id and i.inviter_id=auth.uid()))),'[]'::jsonb);
end; $$;
create or replace function public.cancel_pending_invitation(p_user_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare candidate auth.users%rowtype;
begin
 if not public.team_view_allowed() then raise exception 'Not authorized'; end if;
 if not public.is_panel_owner() and not exists(select 1 from private.consultant_invitations where user_id=p_user_id and inviter_id=auth.uid()) then return false; end if;
 select * into candidate from auth.users where id=p_user_id for update;
 if not found or candidate.invited_at is null or exists(select 1 from private.panel_owners where user_id=p_user_id)
 or not exists(select 1 from private.panel_members where user_id=p_user_id and (password_set_at is null or not exists(select 1 from public.consultant_profiles where user_id=p_user_id))) then return false; end if;
 update private.panel_members set enabled=false where user_id=p_user_id;
 return true;
end; $$;
revoke all on function public.list_consultants(),public.cancel_pending_invitation(uuid) from public,anon;
grant execute on function public.list_consultants(),public.cancel_pending_invitation(uuid) to authenticated;
commit;
