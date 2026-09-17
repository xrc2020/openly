-- OPTIONAL cleanup. Replace target_game with the SAME test game UUID.
-- Removes only registered test accounts plus THIS test game's rotation/history.
-- Keeps the host, venue, game and any real premium purchase. The game remains
-- marked as a test game so future practice results do not enter profile stats.
begin;
do $$
declare target_game uuid := '00000000-0000-0000-0000-000000000000'; -- REPLACE THIS
 game public.open_plays%rowtype;test_ids uuid[];
begin
 select * into game from public.open_plays where id=target_game for update;
 if not found or not exists(select 1 from openly_private.test_games where open_play_id=target_game) then raise exception 'This is not a registered test game.';end if;
 if game.title not like '[TEST] %' or game.fee<>0 then raise exception 'Cleanup requires the original free [TEST] game.';end if;
 select array_agg(user_id) into test_ids from openly_private.test_players where open_play_id=target_game;
 if exists(select 1 from public.open_play_players p where p.open_play_id=target_game and p.user_id<>game.host_id and not(p.user_id=any(coalesce(test_ids,array[]::uuid[])))) then raise exception 'Real participants found. Cleanup stopped.';end if;
 if exists(select 1 from public.open_play_players where user_id=any(test_ids) and open_play_id<>target_game) then raise exception 'A test account is used in another game. Cleanup stopped.';end if;
 if exists(select 1 from public.payment_proofs pr join public.open_play_players p on p.id=pr.registration_id where p.open_play_id=target_game) then raise exception 'Payment proofs found. Cleanup stopped.';end if;
 if exists(select 1 from auth.users where id=any(test_ids) and (email not like 'openly-test-%@example.invalid' or raw_app_meta_data->>'openly_test_fixture' is distinct from 'true')) then raise exception 'Account fixture markers do not match. Cleanup stopped.';end if;
 delete from public.open_play_matches where round_id in(select id from public.open_play_rounds where open_play_id=target_game);
 delete from public.open_play_round_assignments where round_id in(select id from public.open_play_rounds where open_play_id=target_game);
 delete from public.open_play_rounds where open_play_id=target_game;
 delete from openly_private.rotation_requests where event_id=target_game;
 delete from public.open_play_rotation_settings where open_play_id=target_game;
 delete from public.open_play_results where open_play_id=target_game;
 delete from public.open_play_messages where open_play_id=target_game and user_id=any(test_ids);
 delete from public.open_play_players where open_play_id=target_game and user_id=any(test_ids);
 delete from auth.users where id=any(test_ids);
end $$;
commit;
select 'Test accounts and test rotation history removed. Host and game preserved.' as result;
