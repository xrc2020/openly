-- Run once after 009. Three first publications per Philippine day on Free.
begin;
-- Keep publications from slipping between the history backfill and trigger setup.
lock table public.open_plays in share row exclusive mode;
create table openly_private.host_publications (
 event_id uuid primary key references public.open_plays(id),
 host_id uuid not null references public.profiles(id),
 published_at timestamptz not null,
 publication_day date not null
);
create index host_publications_day on openly_private.host_publications(host_id,publication_day);
alter table openly_private.host_publications enable row level security;
revoke all on openly_private.host_publications from public,anon,authenticated;

-- Save receipts record the actual first publication for the current hosting UI.
-- Legacy publications without a receipt use their creation time as a fallback.
insert into openly_private.host_publications(event_id,host_id,published_at,publication_day)
select e.id,e.host_id,coalesce(r.published_at,e.created_at),
 (coalesce(r.published_at,e.created_at) at time zone 'Asia/Manila')::date
from public.open_plays e left join lateral (
 select min(s.created_at) as published_at from openly_private.host_save_requests s
 where s.event_id=e.id and s.payload->>'publish'='true'
) r on true
where e.status in ('published','completed') or r.published_at is not null;

create function openly_private.active_monthly_plus(p_host uuid,p_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.host_subscriptions s where s.host_id=p_host
 and s.plan='openly_plus_monthly' and s.status='active'
 and s.current_period_start<=p_at and s.current_period_end>p_at);
$$;
revoke all on function openly_private.active_monthly_plus(uuid,timestamptz) from public,anon,authenticated;

create function openly_private.enforce_host_daily_limit() returns trigger
language plpgsql security definer set search_path='' as $$
declare at_time timestamptz; day_in_ph date; used integer;
begin
 if new.status<>'published' then return new; end if;
 if tg_op='UPDATE' then
   if old.status='published' then return new; end if;
 end if;
 -- Serialize publications from different tabs or API calls for the same host.
 perform pg_advisory_xact_lock(hashtextextended('host-publications:'||new.host_id::text,0));
 if exists(select 1 from openly_private.host_publications where event_id=new.id) then return new; end if;
 at_time:=clock_timestamp(); day_in_ph:=(at_time at time zone 'Asia/Manila')::date;
 select count(*) into used from openly_private.host_publications where host_id=new.host_id and publication_day=day_in_ph;
 if used>=3 and not openly_private.active_monthly_plus(new.host_id,at_time) then
   raise exception 'Free hosting allows 3 Open Plays per Philippine day. Save a draft, wait until midnight Philippine time, or activate Openly Plus for unlimited hosting.' using errcode='P0001';
 end if;
 insert into openly_private.host_publications(event_id,host_id,published_at,publication_day)
 values(new.id,new.host_id,at_time,day_in_ph);
 return new;
end $$;
revoke all on function openly_private.enforce_host_daily_limit() from public,anon,authenticated;
-- Covers every publishing path, including the older standalone publish RPC.
create trigger openly_host_daily_limit after insert or update of status on public.open_plays
for each row execute function openly_private.enforce_host_daily_limit();

create function public.openly_hosting_allowance() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=openly_private.require_user(); at_time timestamptz:=clock_timestamp();
 day_in_ph date; used integer; plus boolean;
begin
 day_in_ph:=(at_time at time zone 'Asia/Manila')::date;
 plus:=openly_private.active_monthly_plus(u,at_time);
 select count(*) into used from openly_private.host_publications where host_id=u and publication_day=day_in_ph;
 return jsonb_build_object('is_plus',plus,'published_today',used,'daily_limit',case when plus then null else 3 end,
 'remaining',case when plus then null else greatest(0,3-used) end,
 'resets_at',((day_in_ph+1)::timestamp at time zone 'Asia/Manila'),'timezone','Asia/Manila');
end $$;
revoke all on function public.openly_hosting_allowance() from public,anon;
grant execute on function public.openly_hosting_allowance() to authenticated;
commit;
select '010 Openly daily hosting limits installed' as result;
