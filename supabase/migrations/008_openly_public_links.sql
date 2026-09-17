begin;
alter table public.open_plays add column public_id uuid not null default gen_random_uuid();
create unique index open_play_public_id on public.open_plays(public_id);
create function public.openly_public_game(p_public uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('public_id',e.public_id,'title',e.title,'description',e.description,
 'host_name',p.display_name,'starts_at',e.starts_at,'ends_at',e.ends_at,'status',e.status,
 'max_players',e.max_players,'fee',e.fee,'skill_level',e.skill_level,'court_name',e.court_name,
 'cancellation_policy',e.cancellation_policy,'play_style','Manual Play',
 'venue',jsonb_build_object('name',coalesce(e.venue_snapshot->>'name',v.name),
 'address',coalesce(e.venue_snapshot->>'address',v.address),'city',coalesce(e.venue_snapshot->>'city',v.city),
 'google_maps_url',coalesce(e.venue_snapshot->>'google_maps_url',v.google_maps_url)),
 'reserved_slots',(select count(*) from public.open_play_players r where r.open_play_id=e.id and r.registration_status<>'cancelled'),
 'remaining_slots',greatest(0,e.max_players-(select count(*) from public.open_play_players r where r.open_play_id=e.id and r.registration_status<>'cancelled')))
 from public.open_plays e join public.profiles p on p.id=e.host_id join public.venues v on v.id=e.venue_id
 where e.public_id=p_public and e.status<>'draft';
$$;
revoke all on function public.openly_public_game(uuid) from public;
grant execute on function public.openly_public_game(uuid) to anon,authenticated;
-- Internal IDs are resolved only after sign-in; no private data in public HTML.
create function public.openly_resolve_public_game(p_public uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select id from public.open_plays where public_id=p_public and status<>'draft' and auth.uid() is not null;
$$;
revoke all on function public.openly_resolve_public_game(uuid) from public,anon;
grant execute on function public.openly_resolve_public_game(uuid) to authenticated;
commit;
select '008 Openly public links installed' as result;
