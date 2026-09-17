-- Run once AFTER migrations 001 and 002, before installing the accompanying UI.
begin;
alter table public.profiles add column onboarding_completed_at timestamptz;
alter table public.profiles add constraint completed_profile_has_basics check (
  onboarding_completed_at is null or (
    char_length(btrim(display_name)) between 1 and 80 and
    city is not null and char_length(btrim(city)) between 1 and 120 and
    skill_level is not null
  )
);

create function public.openly_complete_onboarding(
  p_display_name text, p_city text, p_skill_level text,
  p_first_name text default null, p_last_name text default null,
  p_phone text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Sign in to continue.'; end if;
  if nullif(btrim(p_display_name),'') is null or nullif(btrim(p_city),'') is null
     or p_skill_level is null or p_skill_level not in ('beginner','intermediate','advanced') then
    raise exception 'Enter a display name, city and skill level.';
  end if;
  update public.profiles set display_name=btrim(p_display_name), city=btrim(p_city),
    skill_level=p_skill_level, onboarding_completed_at=coalesce(onboarding_completed_at,now()) where id=u;
  if not found then raise exception 'Your Openly profile is missing. Please contact support.'; end if;
  insert into public.profile_private(user_id,first_name,last_name,phone)
  values(u,nullif(btrim(p_first_name),''),nullif(btrim(p_last_name),''),nullif(btrim(p_phone),''))
  on conflict(user_id) do update set first_name=excluded.first_name,last_name=excluded.last_name,phone=excluded.phone;
end;
$$;
revoke all on function public.openly_complete_onboarding(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.openly_complete_onboarding(text,text,text,text,text,text) to authenticated;

-- Enforce onboarding in the database as well as in the UI. Existing bookings
-- and published games are unchanged; payment review/cancellation remain usable.
create function openly_private.require_registration_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=new.user_id and onboarding_completed_at is not null) then
    raise exception 'ONBOARDING_REQUIRED';
  end if;
  return new;
end;
$$;
create trigger openly_registration_profile before insert on public.open_play_players
for each row execute function openly_private.require_registration_profile();

create function openly_private.require_host_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='published' and not exists(
    select 1 from public.profiles where id=new.host_id and onboarding_completed_at is not null
  ) then raise exception 'ONBOARDING_REQUIRED'; end if;
  return new;
end;
$$;
create trigger openly_host_profile before insert or update of status on public.open_plays
for each row execute function openly_private.require_host_profile();
revoke all on function openly_private.require_registration_profile(),openly_private.require_host_profile() from public,anon,authenticated;
commit;
select '003 Openly onboarding installed' as result;
