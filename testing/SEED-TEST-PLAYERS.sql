-- OPTIONAL: run manually in Supabase SQL Editor AFTER migration 014.
-- First create a FREE game named "[TEST] Rotation practice" in the website.
-- Set enough slots (e.g. 20), publish it, then paste its UUID below.
-- A published test game is visible in Discover. Prefer a staging project.
-- No email is sent, no password/identity is created, and sign-in is banned.
-- This does NOT create premium payments or grant Plus access.
begin;
do $$
declare
 target_game uuid := '00000000-0000-0000-0000-000000000000'; -- REPLACE THIS
 player_count integer := 20; -- 4 through 40; cannot exceed the game's slots
 game public.open_plays%rowtype;user_key uuid;slot_number integer;
begin
 select * into game from public.open_plays where id=target_game for update;
 if not found then raise exception 'Replace target_game with your test Open Play UUID.';end if;
 if game.title not like '[TEST] %' or game.fee<>0 or game.status<>'published' or game.ends_at<=now() then
 raise exception 'Use a published, free, unexpired Open Play with a title beginning [TEST] followed by a space.';end if;
 if player_count not between 4 and 40 or player_count>game.max_players then raise exception 'Choose 4–40 players within the game slot limit.';end if;
 if exists(select 1 from public.open_play_players p where p.open_play_id=target_game and p.user_id<>game.host_id and not exists(select 1 from openly_private.test_players t where t.user_id=p.user_id and t.open_play_id=target_game)) then
 raise exception 'This game has real participants. Use a separate test game.';end if;
 if exists(select 1 from public.open_play_rounds where open_play_id=target_game) then raise exception 'Rounds already exist. Run the cleanup script before reseeding.';end if;
 if exists(select 1 from public.payment_proofs pr join public.open_play_players p on p.id=pr.registration_id where p.open_play_id=target_game) then raise exception 'This game contains real payment records. Use a separate test game.';end if;
 if exists(select 1 from openly_private.test_players where open_play_id=target_game and slot>player_count) then raise exception 'Run cleanup before reducing the test-player count.';end if;
 if player_count+(select count(*) from public.open_play_players where open_play_id=target_game and user_id=game.host_id and registration_status<>'cancelled')>game.max_players then raise exception 'Leave one additional slot for the registered host.';end if;
 insert into openly_private.test_games(open_play_id) values(target_game) on conflict do nothing;
 for slot_number in 1..player_count loop
  select user_id into user_key from openly_private.test_players where open_play_id=target_game and slot=slot_number;
  if user_key is null then
   user_key:=gen_random_uuid();
   insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,banned_until)
   values(user_key,'authenticated','authenticated','openly-test-'||user_key::text||'@example.invalid',null,null,
   '{"openly_test_fixture":true}'::jsonb,'{}'::jsonb,now(),now(),'2099-12-31T23:59:59Z');
   insert into openly_private.test_players(user_id,open_play_id,slot) values(user_key,target_game,slot_number);
  end if;
  update public.profiles set display_name='TEST Player '||lpad(slot_number::text,2,'0'),city='Test court',skill_level='beginner',onboarding_completed_at=now() where id=user_key;
  insert into public.open_play_players(open_play_id,user_id,registration_status,payment_status,amount_due)
  values(target_game,user_key,'confirmed','not_required',0)
  on conflict(open_play_id,user_id) do update set registration_status='confirmed',payment_status='not_required',amount_due=0,cancelled_at=null,cancellation_reason=null;
 end loop;
 raise notice 'Seeded % test players. Refresh Participants and Rotation. Start rounds during the scheduled game time.',player_count;
end $$;
commit;
select 'Test players created. No real payment or premium access was added.' as result;
