begin;
create table public.support_threads (
 user_id uuid primary key references public.profiles(id),
 status text not null default 'open' check(status in ('open','resolved')),
 updated_at timestamptz not null default now()
);
create table public.support_messages (
 id uuid primary key,thread_user_id uuid not null references public.support_threads(user_id),
 sender_id uuid not null references public.profiles(id),
 body text not null check(char_length(btrim(body)) between 1 and 4000),
 created_at timestamptz not null default clock_timestamp()
);
create index on public.support_messages(thread_user_id,created_at,id);
alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_threads,public.support_messages from public,anon,authenticated;
grant select on public.support_threads,public.support_messages to authenticated;
create policy support_thread_read on public.support_threads for select to authenticated using(user_id=auth.uid() or public.openly_is_admin());
create policy support_message_read on public.support_messages for select to authenticated using(thread_user_id=auth.uid() or public.openly_is_admin());
create function public.openly_support_send(p_id uuid,p_thread uuid,p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=openly_private.require_user();m public.support_messages%rowtype;
begin
 if p_id is null or p_thread is null or nullif(btrim(p_body),'') is null or char_length(btrim(p_body))>4000 then raise exception 'Enter a message up to 4000 characters.';end if;
 if u<>p_thread and not public.openly_is_admin() then raise exception 'This conversation is private.';end if;
 perform pg_advisory_xact_lock(hashtextextended('support:'||p_thread::text,0));
 select * into m from public.support_messages where id=p_id;
 if found then
  if m.thread_user_id<>p_thread or m.sender_id<>u or m.body<>btrim(p_body) then raise exception 'Message request already used.';end if;
  return m.id;
 end if;
 insert into public.support_threads(user_id) values(p_thread) on conflict(user_id) do nothing;
 insert into public.support_messages(id,thread_user_id,sender_id,body) values(p_id,p_thread,u,btrim(p_body));
 update public.support_threads set updated_at=clock_timestamp(),status='open' where user_id=p_thread;
 return p_id;
end $$;
create function public.openly_support_resolve(p_thread uuid,p_resolved boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.openly_is_admin() then raise exception 'Admin access required.';end if;
 if p_resolved is null then raise exception 'Choose a status.';end if;
 update public.support_threads set status=case when p_resolved then 'resolved' else 'open' end where user_id=p_thread;
end $$;
revoke all on function public.openly_support_send(uuid,uuid,text),public.openly_support_resolve(uuid,boolean) from public,anon;
grant execute on function public.openly_support_send(uuid,uuid,text),public.openly_support_resolve(uuid,boolean) to authenticated;
commit;
select '011 Openly support installed' as result;
