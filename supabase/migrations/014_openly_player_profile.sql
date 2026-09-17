begin;
-- SQL-Editor-only fixture registry; never writable through the public API.
create table openly_private.test_games(
 open_play_id uuid primary key references public.open_plays(id),created_at timestamptz not null default now()
);
create table openly_private.test_players(
 user_id uuid primary key references auth.users(id) on delete cascade,
 open_play_id uuid not null references openly_private.test_games(open_play_id),slot integer not null,
 unique(open_play_id,slot)
);
alter table openly_private.test_games enable row level security;
alter table openly_private.test_players enable row level security;
revoke all on openly_private.test_games,openly_private.test_players from public,anon,authenticated;

create function public.openly_my_profile(p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=openly_private.require_user();result jsonb;
begin
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Invalid activity page.';end if;
 with played as (
 select a.*,r.number,r.settings,r.kind,r.completed_at,r.open_play_id,e.title,
 case when a.team=1 then m.a else m.b end as pf,
 case when a.team=1 then m.b else m.a end as pa
 from public.open_play_round_assignments a join public.open_play_rounds r on r.id=a.round_id
 join public.open_plays e on e.id=r.open_play_id left join public.open_play_matches m on m.round_id=r.id and m.court=a.court
 where a.user_id=u and a.court>0 and r.status='completed'
 and not exists(select 1 from openly_private.test_games t where t.open_play_id=e.id)
 ), competitive as(select * from played where settings->>'style'='competitive' and kind='regular' and pf is not null and pa is not null),
 recent as(select * from competitive order by completed_at desc,round_id limit 10),
 activity as(
 select e.id,e.title,e.starts_at,e.status,e.host_id=u as hosting,p.registration_status,p.payment_status,
 coalesce(e.venue_snapshot->>'name',v.name) as venue
 from public.open_plays e left join public.open_play_players p on p.open_play_id=e.id and p.user_id=u
 left join public.venues v on v.id=e.venue_id
 where (e.host_id=u or p.id is not null) and not exists(select 1 from openly_private.test_games t where t.open_play_id=e.id)
 ), activity_page as(select * from activity order by starts_at desc,id limit 10 offset p_page*10)
 select jsonb_build_object(
 'profile',(select jsonb_build_object('id',id,'display_name',display_name,'avatar_url',avatar_url,'city',city,'skill_level',skill_level,'created_at',created_at,'onboarding_completed_at',onboarding_completed_at) from public.profiles where id=u),
 'plus_until',(select max(current_period_end) from public.host_subscriptions where host_id=u and status='active' and current_period_start<=now() and current_period_end>now()),
 'counts',jsonb_build_object('hosted',(select count(*) from activity where hosting and status in ('published','completed')),
 'joined',(select count(*) from activity where registration_status='confirmed'),
 'rounds',(select count(*) from played)),
 'performance',(select jsonb_build_object('games',count(*),'wins',count(*) filter(where pf>pa),'losses',count(*) filter(where pf<pa),'draws',count(*) filter(where pf=pa),'points_for',coalesce(sum(pf),0),'points_against',coalesce(sum(pa),0),'average_points',round(avg(pf),1)) from competitive),
 'matches',coalesce((select jsonb_agg(jsonb_build_object('round_id',round_id,'event_id',open_play_id,'title',title,'number',number,'court',court,'pf',pf,'pa',pa,'completed_at',completed_at,
 'partner',(select string_agg(x.display_name,', ' order by x.player_id) from public.open_play_round_assignments x where x.round_id=recent.round_id and x.court=recent.court and x.team=recent.team and x.user_id<>u),
 'opponents',(select string_agg(x.display_name,' + ' order by x.player_id) from public.open_play_round_assignments x where x.round_id=recent.round_id and x.court=recent.court and x.team<>recent.team)
 ) order by completed_at desc,round_id) from recent),'[]'::jsonb),
 'activity',coalesce((select jsonb_agg(to_jsonb(activity_page) order by starts_at desc,id) from activity_page),'[]'::jsonb),
 'activity_count',(select count(*) from activity)
 ) into result;
 return result;
end $$;
revoke all on function public.openly_my_profile(integer) from public,anon;
grant execute on function public.openly_my_profile(integer) to authenticated;
commit;
select '014 Openly player profile installed' as result;
