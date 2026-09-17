-- Run ONCE after 001–004. No administrator is automatically assigned.
begin;
create function public.openly_is_admin() returns boolean language sql stable
security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from openly_private.admins where user_id=auth.uid());
$$;
revoke all on function public.openly_is_admin() from public,anon,authenticated;
grant execute on function public.openly_is_admin() to authenticated;

-- Only HTTPS Google Maps URLs, never arbitrary websites or script URLs.
-- Links are opened by the browser; our server never fetches/expands them.
create function public.openly_valid_maps_link(p_url text) returns boolean
language sql immutable set search_path = '' as $$
  select p_url is null or (char_length(p_url)<=2048 and p_url !~ '[[:space:]\\]'
    and p_url ~ '^https://((www\.)?google\.com/maps([/?#].*)?|maps\.google\.com/[^[:space:]]*|maps\.app\.goo\.gl/[A-Za-z0-9_-]+([?#].*)?|goo\.gl/maps/[A-Za-z0-9_-]+([?#].*)?)$');
$$;
revoke all on function public.openly_valid_maps_link(text) from public,anon,authenticated;
grant execute on function public.openly_valid_maps_link(text) to anon,authenticated;
alter table public.venues
  add column google_maps_url text check(public.openly_valid_maps_link(google_maps_url)),
  add column is_official boolean not null default false,
  add column is_active boolean not null default true;
create unique index openly_official_venue_unique on public.venues
  (lower(btrim(name)),lower(btrim(address)),lower(btrim(city))) where is_official and is_active;
create policy official_venue_read on public.venues for select to anon,authenticated using(is_official and is_active);
create policy admin_venue_read on public.venues for select to authenticated using(public.openly_is_admin());

create function public.openly_admin_save_venue(p_id uuid,p_name text,p_address text,p_city text,
  p_google_maps_url text,p_is_official boolean,p_is_active boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := openly_private.require_user();
begin
  if not public.openly_is_admin() then raise exception 'Administrator access required.'; end if;
  if p_id is null or p_is_official is null or p_is_active is null then raise exception 'Invalid venue request.'; end if;
  if nullif(btrim(p_name),'') is null or nullif(btrim(p_address),'') is null or nullif(btrim(p_city),'') is null then
    raise exception 'Enter the venue name, address and city.';
  end if;
  if not public.openly_valid_maps_link(nullif(btrim(p_google_maps_url),'')) then raise exception 'Paste a valid HTTPS Google Maps link.'; end if;
  insert into public.venues(id,created_by,name,address,city,google_maps_url,is_official,is_active)
  values(p_id,u,btrim(p_name),btrim(p_address),btrim(p_city),nullif(btrim(p_google_maps_url),''),p_is_official,p_is_active)
  on conflict(id) do update set name=excluded.name,address=excluded.address,city=excluded.city,
    google_maps_url=excluded.google_maps_url,is_official=excluded.is_official,is_active=excluded.is_active;
  return p_id;
exception when unique_violation then raise exception 'An active official venue with that name and address already exists.';
end;
$$;
revoke all on function public.openly_admin_save_venue(uuid,text,text,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.openly_admin_save_venue(uuid,text,text,text,text,boolean,boolean) to authenticated;

alter table public.open_plays add column venue_snapshot jsonb,
  add column draft_payment_method_id uuid references public.payment_methods(id);
-- Preserve current locations on existing published, completed and cancelled games.
update public.open_plays e set venue_snapshot=jsonb_build_object('name',v.name,'address',v.address,'city',v.city,
 'latitude',v.latitude,'longitude',v.longitude,'google_maps_url',v.google_maps_url)
from public.venues v where e.venue_id=v.id and e.status<>'draft';
create function openly_private.check_game_venue() returns trigger language plpgsql
security definer set search_path = '' as $$
declare v public.venues%rowtype;
begin
  select * into v from public.venues where id=new.venue_id for share;
  if v.id is null then raise exception 'Venue not found.'; end if;
  if tg_op='INSERT' or (tg_op='UPDATE' and (new.venue_id<>old.venue_id or (old.status='draft' and new.status='published'))) then
    if not v.is_active then raise exception 'This venue is inactive. Choose another venue.'; end if;
    if not v.is_official and v.created_by<>new.host_id then raise exception 'Choose an official venue or enter your own location.'; end if;
  end if;
  if new.status='published' and (tg_op='INSERT' or old.status='draft') then
    new.venue_snapshot := jsonb_build_object('name',v.name,'address',v.address,'city',v.city,
      'latitude',v.latitude,'longitude',v.longitude,'google_maps_url',v.google_maps_url);
    new.draft_payment_method_id := null;
  end if;
  return new;
end;
$$;
revoke all on function openly_private.check_game_venue() from public,anon,authenticated;
create trigger openly_check_game_venue before insert or update of venue_id,status on public.open_plays
for each row execute function openly_private.check_game_venue();

-- Existing direct business writes remain revoked. The new hosting function
-- below still uses the same receipt IDs and publication/payment snapshot rules.
create or replace function public.openly_create_event(p_title text,p_venue_id uuid,p_starts_at timestamptz,
  p_ends_at timestamptz,p_max_players integer,p_fee numeric,
  p_skill_level text default 'any',p_description text default '',p_court_name text default null,
  p_cancellation_cutoff timestamptz default null,p_cancellation_policy text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid := openly_private.require_user(); result uuid;
begin
  if p_starts_at <= now() then raise exception 'Choose a future start time.'; end if;
  if not exists(select 1 from public.venues v where v.id=p_venue_id and (
    v.is_active and (v.created_by=u or v.is_official)
  )) then raise exception 'Venue is not available.'; end if;
  insert into public.open_plays(host_id,venue_id,title,starts_at,ends_at,max_players,fee,
    skill_level,description,court_name,cancellation_cutoff,cancellation_policy)
  values(u,p_venue_id,btrim(p_title),p_starts_at,p_ends_at,p_max_players,p_fee,
    p_skill_level,p_description,p_court_name,p_cancellation_cutoff,p_cancellation_policy)
  returning id into result;
  return result;
end;
$$;

create or replace function public.openly_save_hosted_game(
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
    update public.venues set google_maps_url=nullif(btrim(p_details->>'google_maps_url'),'') where id=venue;
  elsif not exists(select 1 from public.venues v where v.id=venue and (v.is_active and (v.is_official or v.created_by=u))) then raise exception 'Venue is not available.';
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
  if entry_fee>0 then
    method := nullif(p_details->>'payment_method_id','')::uuid;
    if method is not null then
      if not exists(select 1 from public.payment_methods where id=method and owner_id=u and is_active) then
        raise exception 'Select one of your active payment methods.';
      end if;
    elsif nullif(btrim(p_details->>'account_name'),'') is not null and nullif(btrim(p_details->>'account_number'),'') is not null then
      method := public.openly_save_payment_method(p_details->>'provider',p_details->>'account_name',p_details->>'account_number',nullif(p_details->>'qr_path',''));
    elsif p_publish or nullif(p_details->>'qr_path','') is not null then
      raise exception 'Add account name and number to save these payment details.';
    end if;
  end if;
  update public.open_plays set draft_payment_method_id=method where id=result;
  if p_publish then perform public.openly_publish_event(result,method); end if;
  insert into openly_private.host_save_requests(user_id,request_id,payload,event_id) values(u,p_request_id,payload,result);
  return result;
end;
$$;
revoke all on function public.openly_save_hosted_game(uuid,jsonb,boolean,uuid) from public,anon,authenticated;
grant execute on function public.openly_save_hosted_game(uuid,jsonb,boolean,uuid) to authenticated;

commit;
select '005 Openly venues and QR installed' as result;
