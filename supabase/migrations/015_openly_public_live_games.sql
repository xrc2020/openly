begin;
-- Public projection only. Existing private rotation/chat/payment policies remain.
create function openly_private.spectator_round(p_round uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('number',r.number,'kind',r.kind,'status',r.status,'started_at',r.started_at,'completed_at',r.completed_at,
 'courts',coalesce((select jsonb_agg(jsonb_build_object('court',m.court,'a',m.a,'b',m.b,
 'team_a',(select jsonb_agg(a.display_name order by a.player_id) from public.open_play_round_assignments a where a.round_id=r.id and a.court=m.court and a.team=1),
 'team_b',(select jsonb_agg(a.display_name order by a.player_id) from public.open_play_round_assignments a where a.round_id=r.id and a.court=m.court and a.team=2)
 ) order by m.court) from public.open_play_matches m where m.round_id=r.id),'[]'::jsonb),
 'resting',coalesce((select jsonb_agg(a.display_name order by a.player_id) from public.open_play_round_assignments a where a.round_id=r.id and a.court=0),'[]'::jsonb))
 from public.open_play_rounds r where r.id=p_round;
$$;
revoke all on function openly_private.spectator_round(uuid) from public,anon,authenticated;
create function public.openly_spectator_game(p_event uuid,p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.open_plays%rowtype;begin
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Invalid results page.';end if;
 select * into e from public.open_plays where id=p_event and status in ('published','completed');
 if not found then return null;end if;
 return jsonb_build_object('status',e.status,'starts_at',e.starts_at,'ends_at',e.ends_at,
 'is_live',e.status='published' and e.starts_at<=now() and e.ends_at>now(),
 'summary',(select summary from public.open_play_results where open_play_id=e.id),
 'current_round',case when e.status='published' and e.starts_at<=now() and e.ends_at>now() then
 (select openly_private.spectator_round(id) from public.open_play_rounds where open_play_id=e.id and status='live' order by number desc limit 1) else null end,
 'result_count',(select count(*) from public.open_play_rounds where open_play_id=e.id and status='completed'),
 'results',coalesce((select jsonb_agg(openly_private.spectator_round(x.id) order by x.number desc) from
 (select id,number from public.open_play_rounds where open_play_id=e.id and status='completed' order by number desc limit 20 offset p_page*20) x),'[]'::jsonb));
end $$;
revoke all on function public.openly_spectator_game(uuid,integer) from public,anon;
grant execute on function public.openly_spectator_game(uuid,integer) to anon,authenticated;
create function public.openly_spectator_public_game(p_public uuid,p_page integer default 0) returns jsonb
language sql stable security definer set search_path='' as $$
 select public.openly_spectator_game(e.id,p_page) from public.open_plays e where e.public_id=p_public and e.status in ('published','completed');
$$;
revoke all on function public.openly_spectator_public_game(uuid,integer) from public,anon;
grant execute on function public.openly_spectator_public_game(uuid,integer) to anon,authenticated;
commit;
select '015 Openly public live games installed' as result;
