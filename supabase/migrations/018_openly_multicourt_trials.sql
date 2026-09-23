-- Run once after 017. Existing scores and legacy rounds are preserved.
begin;
alter table public.open_plays add column court_count integer not null default 1 check(court_count between 1 and 20);
update public.open_plays e set court_count=s.courts from public.open_play_rotation_settings s where s.open_play_id=e.id;
alter table public.open_play_rounds add column court_number integer check(court_number between 1 and 20);
drop index public.rotation_one_active;
create unique index rotation_one_active_per_court on public.open_play_rounds(open_play_id,court_number) where status in ('draft','live') and court_number is not null;
-- All commands lock the event row before checking court/player reservations.
create or replace function openly_private.has_feature(p_host uuid,p_feature text,p_event uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select (p_event is null or exists(select 1 from public.open_plays where id=p_event and host_id=p_host)) and (
 exists(select 1 from public.host_subscriptions s join public.premium_plan_features f on f.plan=s.plan
 where s.host_id=p_host and s.status='active' and s.current_period_start<=now() and s.current_period_end>now() and f.feature=p_feature)
 or (p_feature='smart_rotation' and p_event is not null and (
 exists(select 1 from (select event_id from openly_private.host_publications where host_id=p_host order by published_at,event_id limit 3) trials where event_id=p_event)
 or (exists(select 1 from public.open_plays where id=p_event and status='draft') and (select count(*) from openly_private.host_publications where host_id=p_host)<3)))
 or exists(select 1 from public.premium_feature_purchases p where p.host_id=p_host and p.open_play_id=p_event and p.feature=p_feature));
$$;
create or replace function public.openly_hosting_allowance() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=openly_private.require_user(); at_time timestamptz:=clock_timestamp();
 day_in_ph date; used integer; plus boolean;
begin
 day_in_ph:=(at_time at time zone 'Asia/Manila')::date;
 plus:=openly_private.active_monthly_plus(u,at_time);
 select count(*) into used from openly_private.host_publications where host_id=u and publication_day=day_in_ph;
 return jsonb_build_object('trial_remaining',greatest(0,3-(select count(*) from openly_private.host_publications where host_id=u)), 'is_plus',plus,'published_today',used,'daily_limit',case when plus then null else 3 end,
 'remaining',case when plus then null else greatest(0,3-used) end,
 'resets_at',((day_in_ph+1)::timestamp at time zone 'Asia/Manila'),'timezone','Asia/Manila');
end $$;
create or replace function openly_private.lock_saved_rotation() returns trigger
language plpgsql set search_path='' as $$ begin
 if old.version>0 and not (old.style='manual' and new.style in ('social','competitive') and not exists(select 1 from public.open_play_rounds where open_play_id=old.open_play_id)) and (to_jsonb(old)-'courts'-'version') is distinct from (to_jsonb(new)-'courts'-'version') then raise exception 'Play style is locked for this session.';end if;
 return new;
end $$;
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
  update public.open_plays set court_count=coalesce((p_details->>'court_count')::integer,1) where id=result;
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
  insert into public.open_play_rotation_settings(open_play_id,courts) select id,court_count from public.open_plays where id=result on conflict do nothing;
  update public.open_play_rotation_settings set courts=(select court_count from public.open_plays where id=result) where open_play_id=result;
  if coalesce(p_details->>'play_style','manual') not in ('manual','social','competitive') then raise exception 'Choose a valid play style.';end if;
  if coalesce(p_details->>'play_style','manual')<>'manual' and (select version from public.open_play_rotation_settings where open_play_id=result)=0 then
   if not openly_private.has_feature(u,'smart_rotation',result) then raise exception 'Your free trial sessions have been used. Choose Manual Play or unlock Smart Rotation after publishing.';end if;
   update public.open_play_rotation_settings set style=p_details->>'play_style',version=1 where open_play_id=result;
  end if;
  insert into openly_private.host_save_requests(user_id,request_id,payload,event_id) values(u,p_request_id,payload,result);
  return result;
end;
$$;
create or replace function public.openly_rotation_state(p_event uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.open_plays%rowtype;begin
 if not openly_private.rotation_read(p_event) then raise exception 'Rotation opens for the host and confirmed players.';end if;
 select * into e from public.open_plays where id=p_event;
 return jsonb_build_object('host_id',e.host_id,'status',e.status,'starts_at',e.starts_at,'ends_at',e.ends_at,
 'manager',coalesce(e.host_id=auth.uid(),false),'entitled',openly_private.has_feature(e.host_id,'smart_rotation',e.id),
 'court_count',e.court_count,'settings',coalesce((select to_jsonb(s) from public.open_play_rotation_settings s where open_play_id=e.id),
 '{"style":"manual","courts":1,"round_type":"timed","minutes":12,"target":11,"win_by":2,"score_cap":null,"version":0}'::jsonb || jsonb_build_object('courts',e.court_count)),
 'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'user_id',p.user_id,'display_name',f.display_name) order by p.joined_at,p.id)
 from public.open_play_players p join public.profiles f on f.id=p.user_id where p.open_play_id=e.id and p.registration_status='confirmed'),'[]'::jsonb),
 'rounds',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
 'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.court,a.team,a.player_id) from public.open_play_round_assignments a where a.round_id=r.id),'[]'::jsonb),
 'matches',coalesce((select jsonb_agg(to_jsonb(m) order by m.court) from public.open_play_matches m where m.round_id=r.id),'[]'::jsonb)) order by r.number)
 from public.open_play_rounds r where r.open_play_id=e.id),'[]'::jsonb));
end $$;

create or replace function public.openly_rotation_command(p_event uuid,p_request uuid,p_action text,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=openly_private.require_user();e public.open_plays%rowtype;s public.open_play_rotation_settings%rowtype;
 r public.open_play_rounds%rowtype;receipt openly_private.rotation_requests%rowtype;
 result uuid;p jsonb;m record;last_number integer;style text;kind text;target integer;win integer;cap integer;valid boolean; chosen_court integer;
begin
 if p_request is null or jsonb_typeof(p_payload) is distinct from 'object' or p_action is null then raise exception 'Invalid rotation command.';end if;
 select * into e from public.open_plays where id=p_event for update;
 if not found or e.host_id<>u then raise exception 'Only this game’s host can manage rotation.';end if;
 select * into receipt from openly_private.rotation_requests where user_id=u and request_id=p_request;
 if found then
  if receipt.event_id<>p_event or receipt.action<>p_action or receipt.payload<>p_payload then raise exception 'Request already used.';end if;
  return receipt.result;
 end if;
 if e.status not in ('draft','published') then raise exception 'This game is cancelled or completed.';end if;
 insert into public.open_play_rotation_settings(open_play_id,courts) values(e.id,e.court_count) on conflict do nothing;
 select * into s from public.open_play_rotation_settings where open_play_id=e.id;
 if p_action='courts' then
  chosen_court:=(p_payload->>'courts')::integer;
  if chosen_court is null or chosen_court not between 1 and 20 then raise exception 'Choose 1 to 20 courts.';end if;
  if exists(select 1 from public.open_play_rounds where open_play_id=e.id and status in ('draft','live')) then raise exception 'Finish or discard all active rounds before changing courts.';end if;
  update public.open_plays set court_count=chosen_court where id=e.id;
  update public.open_play_rotation_settings set courts=chosen_court,version=case when version>0 then version+1 else 0 end where open_play_id=e.id;
 elsif p_action='configure' then
  if (p_payload->>'version')::integer is distinct from s.version then raise exception 'Settings changed. Refresh and retry.';end if;
  if exists(select 1 from public.open_play_rounds where open_play_id=e.id and status in ('draft','live')) then raise exception 'Complete or discard the current round before changing settings.';end if;
  style:=p_payload->>'style';
  if style is null or style not in ('manual','social','competitive') then raise exception 'Choose a play style.';end if;
  if style<>'manual' and not openly_private.has_feature(e.host_id,'smart_rotation',e.id) then raise exception 'The host needs Openly Plus or this game’s session unlock.';end if;
  if style<>'manual' and exists(select 1 from public.open_play_rounds where open_play_id=e.id and status='completed' and settings->>'style'<>style) then raise exception 'Keep this session’s original play style to preserve its results.';end if;
  -- Qualify the local style variable through the payload to avoid column ambiguity.
  update public.open_play_rotation_settings set style=p_payload->>'style',courts=e.court_count,
   round_type=p_payload->>'round_type',minutes=(p_payload->>'minutes')::integer,target=(p_payload->>'target')::integer,
   win_by=(p_payload->>'win_by')::integer,score_cap=(p_payload->>'score_cap')::integer,version=version+1 where open_play_id=e.id;
 elsif p_action='prepare' then
  if not openly_private.has_feature(e.host_id,'smart_rotation',e.id) then raise exception 'The host needs Openly Plus or this game’s session unlock.';end if;
  if e.status<>'published' or e.ends_at<=clock_timestamp() or s.style='manual' then raise exception 'Publish an active Social or Competitive game first.';end if;
  if (p_payload->>'settings_version')::integer is distinct from s.version then raise exception 'Settings changed. Refresh and retry.';end if;
  select coalesce(max(number),0) into last_number from public.open_play_rounds where open_play_id=e.id;
  if (p_payload->>'last')::integer is distinct from last_number then raise exception 'Another round was created. Refresh and retry.';end if;
  kind:=coalesce(p_payload->>'kind','regular');
  if kind not in ('regular','semifinal','final') or (kind<>'regular' and s.style<>'competitive') then raise exception 'Choose a valid round type.';end if;
  if kind<>'regular' and s.target=7 then raise exception 'Choose a championship target of 11, 15 or 21 in settings first.';end if;
  chosen_court:=case when kind='regular' then (p_payload->>'court')::integer else null end;
  if kind='regular' and (chosen_court is null or chosen_court not between 1 and e.court_count) then raise exception 'Choose an available rented court.';end if;
  if exists(select 1 from public.open_play_rounds x where x.open_play_id=e.id and x.status in ('draft','live')
   and x.id is distinct from nullif(p_payload->>'round','')::uuid
   and (chosen_court is null or x.court_number is null or x.court_number=chosen_court)) then raise exception 'Finish or discard the active round on this court first.';end if;
  if nullif(p_payload->>'round','') is not null then
   select * into r from public.open_play_rounds where id=(p_payload->>'round')::uuid and open_play_id=e.id;
   if not found or r.court_number is distinct from chosen_court or r.status<>'draft' or r.version is distinct from (p_payload->>'version')::integer then raise exception 'This round changed or already started.';end if;
   result:=r.id;
   delete from public.open_play_round_assignments where round_id=r.id;
   delete from public.open_play_matches where round_id=r.id;
   update public.open_play_rounds set version=version+1,kind=coalesce(p_payload->>'kind','regular') where id=r.id;
  else

   result:=gen_random_uuid();
   insert into public.open_play_rounds(id,open_play_id,number,court_number,settings,kind) values(result,e.id,last_number+1,chosen_court,to_jsonb(s)||case when kind<>'regular' then '{"round_type":"score"}'::jsonb else '{}'::jsonb end,kind);
  end if;
  if jsonb_typeof(p_payload->'layout') is distinct from 'array' then raise exception 'Invalid assignments.';end if;
  -- Include every currently confirmed player exactly once, including resting players.
  perform 1 from public.open_play_players where open_play_id=e.id and registration_status='confirmed' for share;
  for p in select value from jsonb_array_elements(p_payload->'layout') loop
   insert into public.open_play_round_assignments(round_id,player_id,user_id,display_name,court,team)
   select result,reg.id,reg.user_id,f.display_name,(p->>'court')::integer,(p->>'team')::integer
   from public.open_play_players reg join public.profiles f on f.id=reg.user_id
   where reg.id=(p->>'player_id')::uuid and reg.open_play_id=e.id and reg.registration_status='confirmed';
   if not found then raise exception 'Roster changed. Regenerate with confirmed players.';end if;
  end loop;
  if kind='regular' and ((select count(*) from public.open_play_round_assignments where round_id=result)<>4
   or exists(select 1 from public.open_play_round_assignments where round_id=result and court<>chosen_court)) then raise exception 'Assign exactly four players to the selected court.';end if;
  if exists(select 1 from public.open_play_round_assignments a join public.open_play_round_assignments b on b.player_id=a.player_id
   join public.open_play_rounds other on other.id=b.round_id where a.round_id=result and a.court>0 and b.court>0 and other.id<>result and other.open_play_id=e.id and other.status in ('draft','live')) then raise exception 'A selected player is already assigned to another court. Refresh and generate again.';end if;
  if not exists(select 1 from public.open_play_round_assignments where round_id=result and court>0) then raise exception 'At least four confirmed players are required.';end if;
  if exists(select 1 from public.open_play_round_assignments where round_id=result and court>s.courts) then raise exception 'Court exceeds the configured court count.';end if;
  for m in select court,count(*) as total,count(*) filter(where team=1) as a from public.open_play_round_assignments where round_id=result and court>0 group by court loop
   if m.total<>4 or m.a<>2 then raise exception 'Each active court needs two teams of two.';end if;
   insert into public.open_play_matches(round_id,court) values(result,m.court);
  end loop;
  if (kind='semifinal' and (select count(*) from public.open_play_matches where round_id=result)<>2) or
     (kind='final' and (select count(*) from public.open_play_matches where round_id=result)<>1) then raise exception 'Use two courts for semifinals or one court for the final.';end if;
 else
  select * into r from public.open_play_rounds where id=(p_payload->>'round')::uuid and open_play_id=e.id;
  if not found or r.version is distinct from (p_payload->>'version')::integer then raise exception 'Round changed. Refresh and retry.';end if;
  result:=r.id;
  if p_action='start' then
   if r.status<>'draft' or e.starts_at>clock_timestamp() or e.ends_at<=clock_timestamp() then raise exception 'Start rounds during the scheduled game time.';end if;
   if not openly_private.has_feature(e.host_id,'smart_rotation',e.id) then raise exception 'Renew Plus or unlock this session before starting.';end if;
   if (select count(*) from public.open_play_round_assignments a join public.open_play_players p on p.id=a.player_id where a.round_id=r.id and p.registration_status='confirmed')<>(select count(*) from public.open_play_round_assignments where round_id=r.id) then raise exception 'Roster changed. Regenerate before starting.';end if;
   update public.open_play_rounds set status='live',started_at=clock_timestamp(),version=version+1 where id=r.id;
  elsif p_action='score' then
   if r.status not in ('live','completed') then raise exception 'Start the round before entering scores.';end if;
   if jsonb_typeof(p_payload->'scores') is distinct from 'array' then raise exception 'Enter scores.';end if;
   for p in select value from jsonb_array_elements(p_payload->'scores') loop
    update public.open_play_matches set a=(p->>'a')::integer,b=(p->>'b')::integer where round_id=r.id and court=(p->>'court')::integer;
    if not found then raise exception 'Court not found in this round.';end if;
   end loop;
   if r.status='completed' then
    target:=(r.settings->>'target')::integer;win:=(r.settings->>'win_by')::integer;cap:=(r.settings->>'score_cap')::integer;
    for m in select * from public.open_play_matches where round_id=r.id loop
     if m.a is null and r.settings->>'style'='competitive' then raise exception 'Competitive rounds require every score.';end if;
     if m.a is not null and (r.settings->>'round_type'='score' or r.kind<>'regular') and (greatest(m.a,m.b)>=target and m.a<>m.b and (abs(m.a-m.b)>=win or greatest(m.a,m.b)=cap) and (cap is null or greatest(m.a,m.b)<=cap)) is distinct from true then raise exception 'Score does not meet target, win-by or cap rules.';end if;
    end loop;
   end if;
   update public.open_play_rounds set version=version+1 where id=r.id;
  elsif p_action='complete' then
   if r.status<>'live' then raise exception 'Only a live round can be completed.';end if;
   target:=(r.settings->>'target')::integer;win:=(r.settings->>'win_by')::integer;cap:=(r.settings->>'score_cap')::integer;
   for m in select * from public.open_play_matches where round_id=r.id loop
    if m.a is null and (r.settings->>'style'='competitive' or r.kind<>'regular') then raise exception 'Enter all court scores before completing this round.';end if;
    if m.a is not null and (r.settings->>'round_type'='score' or r.kind<>'regular') then
     valid:=greatest(m.a,m.b)>=target and m.a<>m.b and (abs(m.a-m.b)>=win or greatest(m.a,m.b)=cap) and (cap is null or greatest(m.a,m.b)<=cap);
     if valid is distinct from true then raise exception 'Score does not meet target, win-by or cap rules.';end if;
    end if;
   end loop;
   update public.open_play_rounds set status='completed',completed_at=clock_timestamp(),version=version+1 where id=r.id;
  elsif p_action='abort' then
   if r.status not in ('draft','live') then raise exception 'This round is already finished.';end if;
   update public.open_play_rounds set status='aborted',completed_at=clock_timestamp(),version=version+1 where id=r.id;
  else raise exception 'Unknown rotation action.';
  end if;
 end if;
 insert into openly_private.rotation_requests values(u,p_request,e.id,p_action,p_payload,result);
 return result;
end $$;
create or replace function public.openly_spectator_game(p_event uuid,p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.open_plays%rowtype;begin
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Invalid results page.';end if;
 select * into e from public.open_plays where id=p_event and status in ('published','completed');
 if not found then return null;end if;
 return jsonb_build_object('status',e.status,'starts_at',e.starts_at,'ends_at',e.ends_at,
 'is_live',e.status='published' and e.starts_at<=now() and e.ends_at>now(),
  'current_rounds',coalesce((select jsonb_agg(openly_private.spectator_round(r.id) order by r.number) from public.open_play_rounds r where r.open_play_id=e.id and r.status='live'),'[]'::jsonb),
 'waiting',coalesce((select jsonb_agg(f.display_name order by p.joined_at) from public.open_play_players p join public.profiles f on f.id=p.user_id where p.open_play_id=e.id and p.registration_status='confirmed' and not exists(select 1 from public.open_play_round_assignments a join public.open_play_rounds r on r.id=a.round_id where a.player_id=p.id and a.court>0 and r.status in ('draft','live'))),'[]'::jsonb),
 'summary',(select summary from public.open_play_results where open_play_id=e.id),
 'current_round',case when e.status='published' and e.starts_at<=now() and e.ends_at>now() then
 (select openly_private.spectator_round(id) from public.open_play_rounds where open_play_id=e.id and status='live' order by number desc limit 1) else null end,
 'result_count',(select count(*) from public.open_play_rounds where open_play_id=e.id and status='completed'),
 'results',coalesce((select jsonb_agg(openly_private.spectator_round(x.id) order by x.number desc) from
 (select id,number from public.open_play_rounds where open_play_id=e.id and status='completed' order by number desc limit 20 offset p_page*20) x),'[]'::jsonb));
end $$;

commit;
