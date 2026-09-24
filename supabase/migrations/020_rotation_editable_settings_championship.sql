-- Apply after 019. Hosts can change session controls between rounds.
-- Each round keeps its saved settings; current courts/controls update atomically.
begin;
create or replace function openly_private.lock_saved_rotation() returns trigger
language plpgsql set search_path='' as $$
begin
 if (to_jsonb(old)-'courts'-'version') is distinct from (to_jsonb(new)-'courts'-'version')
    and exists(select 1 from public.open_play_rounds
      where open_play_id=old.open_play_id and status in ('draft','live')) then
  raise exception 'Finish or discard active rounds before changing session controls.';
 end if;
 return new;
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
  chosen_court:=coalesce((p_payload->>'courts')::integer,e.court_count);
  if chosen_court not between 1 and 20 then raise exception 'Choose 1 to 20 courts.';end if;
  -- The event and its rotation settings change together; existing rounds retain their saved rules.
  update public.open_plays set court_count=chosen_court where id=e.id;
  update public.open_play_rotation_settings set style=p_payload->>'style',courts=chosen_court,
   round_type=case when (p_payload->>'minutes')::integer=0 then 'score' else 'timed' end,minutes=(p_payload->>'minutes')::integer,target=(p_payload->>'target')::integer,
   win_by=(p_payload->>'win_by')::integer,score_cap=(p_payload->>'score_cap')::integer,version=version+1 where open_play_id=e.id;
 elsif p_action='prepare' then
  if not openly_private.has_feature(e.host_id,'smart_rotation',e.id) then raise exception 'The host needs Openly Plus or this game’s session unlock.';end if;
  if e.status<>'published' or e.ends_at<=clock_timestamp() or s.style='manual' then raise exception 'Publish an active Social or Competitive game first.';end if;
  if (p_payload->>'settings_version')::integer is distinct from s.version then raise exception 'Settings changed. Refresh and retry.';end if;
  select coalesce(max(number),0) into last_number from public.open_play_rounds where open_play_id=e.id;
  if (p_payload->>'last')::integer is distinct from last_number then raise exception 'Another round was created. Refresh and retry.';end if;
  kind:=coalesce(p_payload->>'kind','regular');
  if kind not in ('regular','semifinal','final') or (kind<>'regular' and s.style<>'competitive') then raise exception 'Choose a valid round type.';end if;
  
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
  if p_action in ('complete','timeout') and p_payload ? 'scores' then
   if r.status<>'live' then raise exception 'Only live rounds can accept a final score.';end if;
   for p in select value from jsonb_array_elements(p_payload->'scores') loop
    update public.open_play_matches set a=(p->>'a')::integer,b=(p->>'b')::integer where round_id=r.id and court=(p->>'court')::integer;
    if not found then raise exception 'Court not found.';end if;
   end loop;
  end if;
  if p_action='timeout' then
   if r.status<>'live' or r.kind<>'regular' or r.settings->>'round_type'<>'timed'
    or (r.settings->>'minutes')::integer<=0 or clock_timestamp()<r.started_at+make_interval(mins=>(r.settings->>'minutes')::integer)
    then raise exception 'The timer has not ended.';end if;
   if exists(select 1 from public.open_play_matches where round_id=r.id and (a is null or timeout_a is not null)) then raise exception 'Enter scores; timeout can only be confirmed once.';end if;
   update public.open_play_matches set timeout_a=a,timeout_b=b where round_id=r.id;
   update public.open_play_rounds set version=version+1 where id=r.id;
  elsif p_action='start' then
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
   if r.status='completed' then perform openly_private.validate_rotation_finish(r.id);end if;
   update public.open_play_rounds set version=version+1 where id=r.id;
  elsif p_action='complete' then
   if r.status<>'live' then raise exception 'Only a live round can be completed.';end if;
   perform openly_private.validate_rotation_finish(r.id);
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

commit;
