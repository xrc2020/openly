-- Run ONCE after 001, 002 and 003. Existing games and permissions are preserved.
begin;
-- Receipts make retries safe, including a lost response after a successful save.
create table openly_private.host_save_requests (
  user_id uuid not null references public.profiles(id),
  request_id uuid not null,
  payload jsonb not null,
  event_id uuid not null references public.open_plays(id),
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
alter table openly_private.host_save_requests enable row level security;
revoke all on openly_private.host_save_requests from public,anon,authenticated;

create function public.openly_save_hosted_game(
  p_request_id uuid,p_details jsonb,p_publish boolean,p_event uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  u uuid := openly_private.require_user();
  payload jsonb := jsonb_build_object('details',p_details,'publish',p_publish,'event',p_event);
  receipt openly_private.host_save_requests%rowtype;
  e public.open_plays%rowtype;
  venue uuid; method uuid; result uuid;
  starts timestamptz; ends timestamptz; cutoff timestamptz; entry_fee numeric; capacity integer;
begin
  if p_request_id is null or p_publish is null or jsonb_typeof(p_details) is distinct from 'object' then
    raise exception 'Invalid save request.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text || p_request_id::text,0));
  select * into receipt from openly_private.host_save_requests where user_id=u and request_id=p_request_id;
  if found then
    if receipt.payload<>payload then raise exception 'This save request was already used. Reload the saved game before editing.'; end if;
    return receipt.event_id;
  end if;
  if not exists(select 1 from public.profiles where id=u and onboarding_completed_at is not null) then
    raise exception 'Complete your player profile before hosting.';
  end if;
  if p_event is not null then
    select * into e from public.open_plays where id=p_event for update;
    if e.id is null or e.host_id<>u or e.status<>'draft' then
      raise exception 'Only your own drafts can be edited or published.';
    end if;
  end if;
  starts := (p_details->>'starts_at')::timestamptz;
  ends := (p_details->>'ends_at')::timestamptz;
  cutoff := nullif(p_details->>'cancellation_cutoff','')::timestamptz;
  capacity := (p_details->>'max_players')::integer;
  entry_fee := (p_details->>'fee')::numeric;
  if starts is null or ends is null or not isfinite(starts) or not isfinite(ends)
    or starts<=now() or ends<=starts then raise exception 'Choose a future start and an end after the start.'; end if;
  if cutoff is not null and (not isfinite(cutoff) or cutoff>starts) then raise exception 'Cancellation deadline must be at or before the start.'; end if;
  if capacity is null or capacity not between 1 and 500 then raise exception 'Player limit must be from 1 to 500.'; end if;
  if entry_fee is null or entry_fee not between 0 and 100000 or entry_fee<>round(entry_fee,2) then raise exception 'Enter a valid fee with at most two decimal places.'; end if;
  if nullif(btrim(p_details->>'title'),'') is null then raise exception 'Enter a game title.'; end if;
  if coalesce(p_details->>'skill_level','') not in ('any','beginner','intermediate','advanced') then raise exception 'Choose a skill level.'; end if;

  venue := nullif(p_details->>'venue_id','')::uuid;
  if venue is null then
    if nullif(btrim(p_details->>'venue_name'),'') is null or nullif(btrim(p_details->>'address'),'') is null
      or nullif(btrim(p_details->>'city'),'') is null then raise exception 'Enter a venue name, address and city.'; end if;
    venue := public.openly_create_venue(p_details->>'venue_name',p_details->>'address',p_details->>'city');
  elsif not exists(select 1 from public.venues v where v.id=venue and (v.created_by=u or exists(
    select 1 from public.open_plays g where g.venue_id=v.id and g.status<>'draft'
  ))) then raise exception 'Venue is not available.';
  end if;

  if p_event is null then
    result := public.openly_create_event(p_details->>'title',venue,starts,ends,capacity,entry_fee,
      p_details->>'skill_level',coalesce(p_details->>'description',''),nullif(btrim(p_details->>'court_name'),''),
      cutoff,coalesce(p_details->>'cancellation_policy',''));
  else
    update public.open_plays set title=btrim(p_details->>'title'),venue_id=venue,starts_at=starts,ends_at=ends,
      max_players=capacity,fee=entry_fee,skill_level=p_details->>'skill_level',description=coalesce(p_details->>'description',''),
      court_name=nullif(btrim(p_details->>'court_name'),''),cancellation_cutoff=cutoff,
      cancellation_policy=coalesce(p_details->>'cancellation_policy','') where id=p_event;
    result := p_event;
  end if;
  if p_publish then
    if entry_fee>0 then
      method := nullif(p_details->>'payment_method_id','')::uuid;
      if method is null then
        if nullif(btrim(p_details->>'account_name'),'') is null or nullif(btrim(p_details->>'account_number'),'') is null then
          raise exception 'Add payment details before publishing a paid game.';
        end if;
        method := public.openly_save_payment_method(p_details->>'provider',p_details->>'account_name',p_details->>'account_number');
      end if;
    end if;
    perform public.openly_publish_event(result,method);
  end if;
  insert into openly_private.host_save_requests(user_id,request_id,payload,event_id) values(u,p_request_id,payload,result);
  return result;
end;
$$;
revoke all on function public.openly_save_hosted_game(uuid,jsonb,boolean,uuid) from public,anon,authenticated;
grant execute on function public.openly_save_hosted_game(uuid,jsonb,boolean,uuid) to authenticated;
commit;
select '004 Openly hosting installed' as result;
