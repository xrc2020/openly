begin;
create table public.open_play_rotation_settings (
 open_play_id uuid primary key references public.open_plays(id),
 style text not null default 'manual' check(style in ('manual','social','competitive')),
 courts integer not null default 1 check(courts between 1 and 20),
 round_type text not null default 'timed' check(round_type in ('timed','score')),
 minutes integer not null default 12 check(minutes between 1 and 180),
 target integer not null default 11 check(target in (7,11,15,21)),
 win_by integer not null default 2 check(win_by in (1,2)),
 score_cap integer check(score_cap between target and 199),
 version integer not null default 0
);
create table public.open_play_rounds (
 id uuid primary key,open_play_id uuid not null references public.open_plays(id),
 number integer not null,status text not null default 'draft' check(status in ('draft','live','completed','aborted')),
 settings jsonb not null,kind text not null default 'regular' check(kind in ('regular','semifinal','final')),
 version integer not null default 1,started_at timestamptz,completed_at timestamptz,
 unique(open_play_id,number)
);
create unique index rotation_one_active on public.open_play_rounds(open_play_id) where status in ('draft','live');
create table public.open_play_round_assignments (
 round_id uuid not null references public.open_play_rounds(id),player_id uuid not null references public.open_play_players(id),
 user_id uuid not null references public.profiles(id),display_name text not null,
 court integer not null check(court between 0 and 20),team integer not null check(team between 0 and 2),
 primary key(round_id,player_id),check((court=0 and team=0) or (court>0 and team in (1,2)))
);
create table public.open_play_matches (
 round_id uuid not null references public.open_play_rounds(id),court integer not null,
 a integer check(a between 0 and 199),b integer check(b between 0 and 199),
 primary key(round_id,court),check((a is null)=(b is null))
);
create table openly_private.rotation_requests (
 user_id uuid not null,request_id uuid not null,event_id uuid not null,
 action text not null,payload jsonb not null,result uuid,primary key(user_id,request_id)
);
alter table openly_private.rotation_requests enable row level security;
revoke all on openly_private.rotation_requests from public,anon,authenticated;
create function openly_private.rotation_read(p_event uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (openly_private.can_manage(p_event) or public.openly_room_access(p_event));
$$;
revoke all on function openly_private.rotation_read(uuid) from public,anon;
grant execute on function openly_private.rotation_read(uuid) to authenticated;
do $$ declare t text;begin
 foreach t in array array['open_play_rotation_settings','open_play_rounds','open_play_round_assignments','open_play_matches'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;end $$;
create policy rotation_settings_read on public.open_play_rotation_settings for select to authenticated using(openly_private.rotation_read(open_play_id));
create policy rotation_round_read on public.open_play_rounds for select to authenticated using(openly_private.rotation_read(open_play_id));
create policy rotation_assignments_read on public.open_play_round_assignments for select to authenticated using(exists(select 1 from public.open_play_rounds r where r.id=round_id));
create policy rotation_matches_read on public.open_play_matches for select to authenticated using(exists(select 1 from public.open_play_rounds r where r.id=round_id));

create function public.openly_rotation_state(p_event uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.open_plays%rowtype;begin
 if not openly_private.rotation_read(p_event) then raise exception 'Rotation opens for the host and confirmed players.';end if;
 select * into e from public.open_plays where id=p_event;
 return jsonb_build_object('host_id',e.host_id,'status',e.status,'starts_at',e.starts_at,'ends_at',e.ends_at,
 'manager',openly_private.can_manage(e.id),'entitled',openly_private.has_feature(e.host_id,'smart_rotation',e.id),
 'settings',coalesce((select to_jsonb(s) from public.open_play_rotation_settings s where open_play_id=e.id),
 '{"style":"manual","courts":1,"round_type":"timed","minutes":12,"target":11,"win_by":2,"score_cap":null,"version":0}'::jsonb),
 'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'user_id',p.user_id,'display_name',f.display_name) order by p.joined_at,p.id)
 from public.open_play_players p join public.profiles f on f.id=p.user_id where p.open_play_id=e.id and p.registration_status='confirmed'),'[]'::jsonb),
 'rounds',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
 'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.court,a.team,a.player_id) from public.open_play_round_assignments a where a.round_id=r.id),'[]'::jsonb),
 'matches',coalesce((select jsonb_agg(to_jsonb(m) order by m.court) from public.open_play_matches m where m.round_id=r.id),'[]'::jsonb)) order by r.number)
 from public.open_play_rounds r where r.open_play_id=e.id),'[]'::jsonb));
end $$;

create function public.openly_rotation_command(p_event uuid,p_request uuid,p_action text,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=openly_private.require_user();e public.open_plays%rowtype;s public.open_play_rotation_settings%rowtype;
 r public.open_play_rounds%rowtype;receipt openly_private.rotation_requests%rowtype;
 result uuid;p jsonb;m record;last_number integer;style text;kind text;target integer;win integer;cap integer;valid boolean;
begin
 if p_request is null or jsonb_typeof(p_payload) is distinct from 'object' or p_action is null then raise exception 'Invalid rotation command.';end if;
 select * into e from public.open_plays where id=p_event for update;
 if not found or not openly_private.can_manage(p_event) then raise exception 'Only the host or an admin can manage rotation.';end if;
 select * into receipt from openly_private.rotation_requests where user_id=u and request_id=p_request;
 if found then
  if receipt.event_id<>p_event or receipt.action<>p_action or receipt.payload<>p_payload then raise exception 'Request already used.';end if;
  return receipt.result;
 end if;
 if e.status not in ('draft','published') then raise exception 'This game is cancelled or completed.';end if;
 insert into public.open_play_rotation_settings(open_play_id) values(e.id) on conflict do nothing;
 select * into s from public.open_play_rotation_settings where open_play_id=e.id;
 if p_action='configure' then
  if (p_payload->>'version')::integer is distinct from s.version then raise exception 'Settings changed. Refresh and retry.';end if;
  if exists(select 1 from public.open_play_rounds where open_play_id=e.id and status in ('draft','live')) then raise exception 'Complete or discard the current round before changing settings.';end if;
  style:=p_payload->>'style';
  if style is null or style not in ('manual','social','competitive') then raise exception 'Choose a play style.';end if;
  if style<>'manual' and not openly_private.has_feature(e.host_id,'smart_rotation',e.id) then raise exception 'The host needs Openly Plus or this game’s session unlock.';end if;
  if style<>'manual' and exists(select 1 from public.open_play_rounds where open_play_id=e.id and status='completed' and settings->>'style'<>style) then raise exception 'Keep this session’s original play style to preserve its results.';end if;
  -- Qualify the local style variable through the payload to avoid column ambiguity.
  update public.open_play_rotation_settings set style=p_payload->>'style',courts=(p_payload->>'courts')::integer,
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
  if nullif(p_payload->>'round','') is not null then
   select * into r from public.open_play_rounds where id=(p_payload->>'round')::uuid and open_play_id=e.id;
   if not found or r.status<>'draft' or r.version is distinct from (p_payload->>'version')::integer then raise exception 'This round changed or already started.';end if;
   result:=r.id;
   delete from public.open_play_round_assignments where round_id=r.id;
   delete from public.open_play_matches where round_id=r.id;
   update public.open_play_rounds set version=version+1,kind=coalesce(p_payload->>'kind','regular') where id=r.id;
  else
   if exists(select 1 from public.open_play_rounds where open_play_id=e.id and status in ('draft','live')) then raise exception 'Finish the current round first.';end if;
   result:=gen_random_uuid();
   insert into public.open_play_rounds(id,open_play_id,number,settings,kind) values(result,e.id,last_number+1,to_jsonb(s)||case when kind<>'regular' then '{"round_type":"score"}'::jsonb else '{}'::jsonb end,kind);
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
  if (select count(*) from public.open_play_round_assignments where round_id=result)<>(select count(*) from public.open_play_players where open_play_id=e.id and registration_status='confirmed') then raise exception 'Roster changed. Regenerate with confirmed players.';end if;
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
   if (select count(*) from public.open_play_round_assignments a join public.open_play_players p on p.id=a.player_id where a.round_id=r.id and p.registration_status='confirmed')<>(select count(*) from public.open_play_round_assignments where round_id=r.id)
    or (select count(*) from public.open_play_players where open_play_id=e.id and registration_status='confirmed')<>(select count(*) from public.open_play_round_assignments where round_id=r.id) then raise exception 'Roster changed. Regenerate before starting.';end if;
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
revoke all on function public.openly_rotation_state(uuid),public.openly_rotation_command(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.openly_rotation_state(uuid),public.openly_rotation_command(uuid,uuid,text,jsonb) to authenticated;
create or replace function public.openly_public_game(p_public uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('public_id',e.public_id,'title',e.title,'description',e.description,
 'host_name',p.display_name,'starts_at',e.starts_at,'ends_at',e.ends_at,'status',e.status,
 'max_players',e.max_players,'fee',e.fee,'skill_level',e.skill_level,'court_name',e.court_name,
 'cancellation_policy',e.cancellation_policy,'play_style',coalesce((select case s.style when 'social' then 'Social' when 'competitive' then 'Competitive' else 'Manual Play' end from public.open_play_rotation_settings s where s.open_play_id=e.id),'Manual Play'),
 'venue',jsonb_build_object('name',coalesce(e.venue_snapshot->>'name',v.name),
 'address',coalesce(e.venue_snapshot->>'address',v.address),'city',coalesce(e.venue_snapshot->>'city',v.city),
 'google_maps_url',coalesce(e.venue_snapshot->>'google_maps_url',v.google_maps_url)),
 'reserved_slots',(select count(*) from public.open_play_players r where r.open_play_id=e.id and r.registration_status<>'cancelled'),
 'remaining_slots',greatest(0,e.max_players-(select count(*) from public.open_play_players r where r.open_play_id=e.id and r.registration_status<>'cancelled')))
 from public.open_plays e join public.profiles p on p.id=e.host_id join public.venues v on v.id=e.venue_id
 where e.public_id=p_public and e.status<>'draft';
$$;
commit;
select '012 Openly Smart Rotation installed' as result;
