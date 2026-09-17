-- Run once after 006. Only names and participation state become public.
-- Rejected proofs are hidden until resubmission; payment history is preserved.
begin;
create or replace function public.openly_roster(p_event uuid)
returns table(display_name text,registration_status text)
language sql stable security definer set search_path='' as $$
 select f.display_name,p.registration_status
 from public.open_play_players p
 join public.profiles f on f.id=p.user_id
 join public.open_plays e on e.id=p.open_play_id
 where e.id=p_event and e.status in ('published','completed','cancelled')
 and p.registration_status in ('reserved','confirmed') and p.payment_status<>'rejected'
 order by (p.registration_status='confirmed') desc,p.joined_at,p.id;
$$;
revoke all on function public.openly_roster(uuid) from public;
grant execute on function public.openly_roster(uuid) to anon,authenticated;
commit;
select '007 Openly participant visibility installed' as result;
