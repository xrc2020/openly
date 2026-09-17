begin;
-- Serialize host participation with every other capacity-changing action.
create function public.openly_host_player(p_event uuid,p_join boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=openly_private.require_user();e public.open_plays%rowtype;p public.open_play_players%rowtype;result uuid;
begin
 select * into e from public.open_plays where id=p_event for update;
 if not found or e.host_id<>u then raise exception 'Only this game’s host can change their player slot.';end if;
 if p_join is null then raise exception 'Choose join or leave.';end if;
 if e.status<>'published' or e.ends_at<=now() then raise exception 'This game is no longer accepting player changes.';end if;
 select * into p from public.open_play_players where open_play_id=e.id and user_id=u;
 if p_join then
  if p.registration_status='confirmed' then return p.id;end if;
  if p.id is not null and exists(select 1 from public.payment_proofs where registration_id=p.id and status in ('pending_review','approved')) then
   raise exception 'Your existing receipt needs admin review before changing to a host player slot.';
  end if;
  if (p.id is null or p.registration_status='cancelled') and
   (select count(*) from public.open_play_players where open_play_id=e.id and registration_status<>'cancelled')>=e.max_players then raise exception 'This game is full.';end if;
  insert into public.open_play_players(open_play_id,user_id,amount_due,registration_status,payment_status)
  values(e.id,u,0,'confirmed','not_required')
  on conflict(open_play_id,user_id) do update set amount_due=0,registration_status='confirmed',payment_status='not_required',cancelled_at=null,cancellation_reason=null
  returning id into result;
  return result;
 else
  if p.id is null or p.registration_status='cancelled' then return p.id;end if;
  if exists(select 1 from public.open_play_round_assignments a join public.open_play_rounds r on r.id=a.round_id where a.player_id=p.id and r.status in ('draft','live')) then
   raise exception 'Finish the active round or discard its draft before leaving your player slot.';
  end if;
  update public.open_play_players set registration_status='cancelled',cancelled_at=now(),cancellation_reason='Host left player slot; remains organizer' where id=p.id;
  return p.id;
 end if;
end $$;
revoke all on function public.openly_host_player(uuid,boolean) from public,anon;
grant execute on function public.openly_host_player(uuid,boolean) to authenticated;

create function public.openly_finish_event(p_event uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=openly_private.require_user();e public.open_plays%rowtype;
begin
 select * into e from public.open_plays where id=p_event for update;
 if not found or not openly_private.can_manage(e.id) then raise exception 'Only the host or an admin can end this Open Play.';end if;
 if e.status='completed' then return;end if;
 if e.status<>'published' or e.starts_at>now() then raise exception 'Only a started, published Open Play can be ended.';end if;
 if exists(select 1 from public.open_play_rounds where open_play_id=e.id and status in ('draft','live')) then raise exception 'Finish the live round or discard the draft before ending this Open Play.';end if;
 update public.open_plays set status='completed' where id=e.id;
end $$;
revoke all on function public.openly_finish_event(uuid) from public,anon;
grant execute on function public.openly_finish_event(uuid) to authenticated;

-- Also protect host slots changed through the older cancellation action.
create function openly_private.guard_host_round_slot() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.registration_status='confirmed' and new.registration_status<>'confirmed'
 and exists(select 1 from public.open_plays where id=old.open_play_id and host_id=old.user_id and status='published')
 and exists(select 1 from public.open_play_round_assignments a join public.open_play_rounds r on r.id=a.round_id where a.player_id=old.id and r.status in ('draft','live')) then
  raise exception 'Finish the active round or discard its draft before leaving your player slot.';
 end if;
 return new;
end $$;
create trigger openly_host_round_slot before update of registration_status on public.open_play_players
for each row execute function openly_private.guard_host_round_slot();

-- Saved configuration is immutable, including through direct RPC requests.
create function openly_private.lock_saved_rotation() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.version>0 then raise exception 'Play style is locked for this session.';end if;
 return new;
end $$;
create trigger openly_saved_rotation before update on public.open_play_rotation_settings
for each row execute function openly_private.lock_saved_rotation();
commit;
select '016 Openly host player and session controls installed' as result;
