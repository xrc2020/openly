-- Run once after 005. Existing payment actions and private storage remain in use.
begin;
create function public.openly_room_access(p_event uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.open_plays e where e.id=p_event and e.status<>'draft')
 and (openly_private.can_manage(p_event) or exists(select 1 from public.open_play_players p
 where p.open_play_id=p_event and p.user_id=auth.uid() and p.registration_status='confirmed'));
$$;
revoke all on function public.openly_room_access(uuid) from public,anon;
grant execute on function public.openly_room_access(uuid) to authenticated;
create function public.openly_roster(p_event uuid)
returns table(display_name text,registration_status text) language sql stable security definer set search_path='' as $$
 select f.display_name,p.registration_status from public.open_play_players p join public.profiles f on f.id=p.user_id
 where p.open_play_id=p_event and p.registration_status='confirmed' and public.openly_room_access(p_event)
 order by p.joined_at,p.id;
$$;
revoke all on function public.openly_roster(uuid) from public,anon;
grant execute on function public.openly_roster(uuid) to authenticated;
create table public.open_play_messages (
 id uuid primary key,open_play_id uuid not null references public.open_plays(id),
 user_id uuid not null references public.profiles(id),body text not null check(char_length(btrim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index on public.open_play_messages(open_play_id,created_at);
alter table public.open_play_messages enable row level security;
revoke all on public.open_play_messages from anon,authenticated;
grant select,insert on public.open_play_messages to authenticated;
create policy room_message_read on public.open_play_messages for select to authenticated using(public.openly_room_access(open_play_id));
create policy room_message_insert on public.open_play_messages for insert to authenticated with check(
 user_id=auth.uid() and public.openly_room_access(open_play_id)
 and exists(select 1 from public.open_plays e where e.id=open_play_id and e.status in ('published','completed'))
 and created_at between now()-interval '1 minute' and now()+interval '1 minute');
create table public.open_play_results (
 open_play_id uuid primary key references public.open_plays(id),summary text not null check(char_length(btrim(summary)) between 1 and 5000)
);
alter table public.open_play_results enable row level security;
revoke all on public.open_play_results from anon,authenticated;
grant select,insert,update on public.open_play_results to authenticated;
create policy result_read on public.open_play_results for select to authenticated using(public.openly_room_access(open_play_id));
create policy result_insert on public.open_play_results for insert to authenticated with check(openly_private.can_manage(open_play_id)
 and exists(select 1 from public.open_plays e where e.id=open_play_id and e.status in ('published','completed') and e.starts_at<=now()));
create policy result_update on public.open_play_results for update to authenticated using(openly_private.can_manage(open_play_id)) with check(openly_private.can_manage(open_play_id)
 and exists(select 1 from public.open_plays e where e.id=open_play_id and e.status in ('published','completed') and e.starts_at<=now()));
commit;
select '006 Openly game rooms installed' as result;
