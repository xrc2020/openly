-- Run manually in the Supabase SQL Editor AFTER 005.
-- Replace ONLY the placeholder below with your Google user's UUID from
-- Authentication > Users. Do not use an email, API key or OAuth client ID.
-- This is a trusted database operation; no website visitor can grant this role.
begin;
do $$
declare target uuid := 'REPLACE-WITH-YOUR-AUTH-USER-UUID';
begin
  if not exists(select 1 from auth.users where id=target) then raise exception 'Auth user not found.'; end if;
  insert into openly_private.admins(user_id) values(target) on conflict(user_id) do nothing;
end;
$$;
commit;
select 'Openly admin assigned' as result;
