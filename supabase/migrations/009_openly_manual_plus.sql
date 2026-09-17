-- Manual Openly platform payments. No changes to participant-to-host payments.
begin;
create table public.platform_payment_settings (
 id boolean primary key default true check(id),enabled boolean not null default false,
 provider text not null check(provider in ('gcash','maya','bank_transfer')),
 account_name text not null check(char_length(btrim(account_name)) between 1 and 160),
 account_number text not null check(char_length(btrim(account_number)) between 1 and 80),
 qr_path text not null,updated_at timestamptz not null default now()
);
create table public.platform_orders (
 id uuid primary key,host_id uuid not null references public.profiles(id),
 product text not null check(product in ('smart_rotation_session','openly_plus_monthly')),
 open_play_id uuid references public.open_plays(id),amount numeric(10,2) not null,
 currency text not null default 'PHP' check(currency='PHP'),payment_snapshot jsonb not null,
 status text not null default 'awaiting_payment' check(status in ('awaiting_payment','pending_review','approved','rejected','cancelled')),
 payment_reference text,created_at timestamptz not null default now(),approved_at timestamptz,
 check((product='smart_rotation_session' and open_play_id is not null and amount=39) or
 (product='openly_plus_monthly' and open_play_id is null and amount=399))
);
create unique index one_open_monthly_order on public.platform_orders(host_id) where product='openly_plus_monthly' and status in ('awaiting_payment','pending_review','rejected');
create unique index one_open_session_order on public.platform_orders(open_play_id) where product='smart_rotation_session' and status in ('awaiting_payment','pending_review','rejected');
create unique index platform_verified_reference on public.platform_orders(payment_reference) where status='approved';
create table public.platform_payment_receipts (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.platform_orders(id),
 object_path text not null unique,payment_reference text not null check(char_length(btrim(payment_reference)) between 3 and 120),
 status text not null default 'pending_review' check(status in ('pending_review','approved','rejected')),
 rejection_reason text,submitted_at timestamptz not null default now(),reviewed_at timestamptz,
 reviewed_by uuid references public.profiles(id)
);
create unique index one_pending_platform_receipt on public.platform_payment_receipts(order_id) where status='pending_review';
create table public.premium_features (feature text primary key);
insert into public.premium_features values('smart_rotation');
create table public.premium_plan_features (plan text not null,feature text not null references public.premium_features(feature),primary key(plan,feature));
insert into public.premium_plan_features values('openly_plus_monthly','smart_rotation');
create table public.host_subscriptions (
 id uuid primary key default gen_random_uuid(),host_id uuid not null references public.profiles(id),
 source_order_id uuid not null unique references public.platform_orders(id),plan text not null default 'openly_plus_monthly' check(plan='openly_plus_monthly'),
 status text not null default 'active' check(status in ('active','cancelled')),
 current_period_start timestamptz not null,current_period_end timestamptz not null,
 check(current_period_end>current_period_start)
);
create index on public.host_subscriptions(host_id,current_period_end);
create table public.premium_feature_purchases (
 id uuid primary key default gen_random_uuid(),host_id uuid not null references public.profiles(id),
 open_play_id uuid not null references public.open_plays(id),feature text not null references public.premium_features(feature),
 source_order_id uuid not null unique references public.platform_orders(id),created_at timestamptz not null default now(),
 unique(open_play_id,feature)
);
do $$ declare t text; begin
 foreach t in array array['platform_payment_settings','platform_orders','platform_payment_receipts','premium_features','premium_plan_features','host_subscriptions','premium_feature_purchases'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy platform_settings_read on public.platform_payment_settings for select to authenticated using(true);
create policy platform_orders_read on public.platform_orders for select to authenticated using(host_id=auth.uid() or public.openly_is_admin());
create policy platform_receipts_read on public.platform_payment_receipts for select to authenticated using(exists(select 1 from public.platform_orders o where o.id=order_id));
create policy premium_features_read on public.premium_features for select to authenticated using(true);
create policy premium_plan_features_read on public.premium_plan_features for select to authenticated using(true);
create policy host_subscription_read on public.host_subscriptions for select to authenticated using(host_id=auth.uid() or public.openly_is_admin());
create policy feature_purchase_read on public.premium_feature_purchases for select to authenticated using(host_id=auth.uid() or public.openly_is_admin());

create function openly_private.has_feature(p_host uuid,p_feature text,p_event uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select (p_event is null or exists(select 1 from public.open_plays where id=p_event and host_id=p_host)) and (
 exists(select 1 from public.host_subscriptions s join public.premium_plan_features f on f.plan=s.plan
 where s.host_id=p_host and s.status='active' and s.current_period_start<=now() and s.current_period_end>now() and f.feature=p_feature)
 or exists(select 1 from public.premium_feature_purchases p where p.host_id=p_host and p.open_play_id=p_event and p.feature=p_feature));
$$;
revoke all on function openly_private.has_feature(uuid,text,uuid) from public,anon,authenticated;
create function public.openly_has_feature(p_host uuid,p_feature text,p_event uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (auth.uid()=p_host or public.openly_is_admin() or exists(
 select 1 from public.open_play_players r where r.open_play_id=p_event and r.user_id=auth.uid()))
 and openly_private.has_feature(p_host,p_feature,p_event);
$$;

create function public.openly_save_platform_payment(p_enabled boolean,p_provider text,p_account_name text,p_account_number text,p_qr_path text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.openly_is_admin() then raise exception 'Admin access required.'; end if;
 if p_enabled is null or p_qr_path is null or split_part(p_qr_path,'/',1)<>auth.uid()::text or not exists(
 select 1 from storage.objects where bucket_id='platform-qrs' and name=p_qr_path) then
 -- Other admins can keep the already configured QR, but not attach arbitrary objects.
 if p_enabled is null or p_qr_path is null or not exists(select 1 from public.platform_payment_settings where qr_path=p_qr_path) then raise exception 'Upload the Openly payment QR first.'; end if;
 end if;
 insert into public.platform_payment_settings(id,enabled,provider,account_name,account_number,qr_path)
 values(true,p_enabled,p_provider,btrim(p_account_name),btrim(p_account_number),p_qr_path)
 on conflict(id) do update set enabled=excluded.enabled,provider=excluded.provider,account_name=excluded.account_name,
 account_number=excluded.account_number,qr_path=excluded.qr_path,updated_at=now();
end $$;

create function public.openly_create_platform_order(p_request uuid,p_product text,p_event uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=openly_private.require_user();settings public.platform_payment_settings%rowtype;o public.platform_orders%rowtype;result uuid;
begin
 if p_request is null or p_product is null or p_product not in ('smart_rotation_session','openly_plus_monthly') then raise exception 'Choose a valid purchase.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('platform-order:'||u::text,0));
 select * into o from public.platform_orders where id=p_request;
 if found then
 if o.host_id<>u or o.product<>p_product or o.open_play_id is distinct from p_event then raise exception 'This request ID is already in use.';end if;
 return o.id;end if;
 if not exists(select 1 from public.profiles where id=u and onboarding_completed_at is not null) then raise exception 'Complete your profile before purchasing.';end if;
 if p_product='smart_rotation_session' then
 if not exists(select 1 from public.open_plays where id=p_event and host_id=u and status in ('draft','published') and ends_at>now()) then raise exception 'Choose one of your upcoming or active games.';end if;
 if openly_private.has_feature(u,'smart_rotation',p_event) then raise exception 'Smart Rotation is already included for this game.';end if;
 elsif p_event is not null then raise exception 'Monthly Plus is not tied to a game.';end if;
 select id into result from public.platform_orders where host_id=u and product=p_product and open_play_id is not distinct from p_event
 and status in ('awaiting_payment','pending_review','rejected');
 if result is not null then return result;end if;
 select * into settings from public.platform_payment_settings where id=true and enabled;
 if not found then raise exception 'Premium purchases are not open yet. Continue hosting free.';end if;
 insert into public.platform_orders(id,host_id,product,open_play_id,amount,payment_snapshot)
 values(p_request,u,p_product,p_event,case when p_product='smart_rotation_session' then 39 else 399 end,
 jsonb_build_object('provider',settings.provider,'account_name',settings.account_name,'account_number',settings.account_number,'qr_path',settings.qr_path));
 return p_request;
end $$;

create function public.openly_submit_platform_receipt(p_order uuid,p_path text,p_reference text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=openly_private.require_user();o public.platform_orders%rowtype;r public.platform_payment_receipts%rowtype;result uuid;ref text:=upper(btrim(p_reference));
begin
 select * into o from public.platform_orders where id=p_order and host_id=u for update;
 if not found then raise exception 'Purchase not found.';end if;
 select * into r from public.platform_payment_receipts where object_path=p_path;
 if found then
 if r.order_id<>p_order or r.payment_reference is distinct from ref then raise exception 'Receipt already used.';end if;
 return r.id;end if;
 if o.status not in ('awaiting_payment','rejected') then raise exception 'This purchase is not awaiting a receipt.';end if;
 if ref is null or char_length(ref) not between 3 and 120 then raise exception 'Enter the payment transaction reference.';end if;
 if p_path is null or split_part(p_path,'/',1)<>u::text or split_part(p_path,'/',2)<>o.id::text or not exists(
 select 1 from storage.objects where bucket_id='platform-proofs' and name=p_path) then raise exception 'Upload your receipt first.';end if;
 insert into public.platform_payment_receipts(order_id,object_path,payment_reference) values(o.id,p_path,ref) returning id into result;
 update public.platform_orders set status='pending_review',payment_reference=ref where id=o.id;
 return result;
end $$;

create function public.openly_review_platform_receipt(p_receipt uuid,p_approve boolean,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=openly_private.require_user();o public.platform_orders%rowtype;r public.platform_payment_receipts%rowtype;host uuid;period_start timestamptz;
begin
 if not public.openly_is_admin() then raise exception 'Admin access required.';end if;
 select o2.host_id into host from public.platform_orders o2 join public.platform_payment_receipts r2 on r2.order_id=o2.id where r2.id=p_receipt;
 if host is null then raise exception 'Receipt not found.';end if;
 if host=u then raise exception 'Another administrator must review your own payment.';end if;
 perform pg_advisory_xact_lock(hashtextextended('platform-approval:'||host::text,0));
 select o2.* into o from public.platform_orders o2 join public.platform_payment_receipts r2 on r2.order_id=o2.id where r2.id=p_receipt for update of o2;
 select * into r from public.platform_payment_receipts where id=p_receipt for update;
 if p_approve is null then raise exception 'Choose Approve or Reject.';end if;
 if r.status='approved' and p_approve and o.status='approved' then return;end if;
 if r.status='rejected' and not p_approve then return;end if;
 if r.status<>'pending_review' or o.status<>'pending_review' then raise exception 'This receipt is no longer pending.';end if;
 if not p_approve and nullif(btrim(p_reason),'') is null then raise exception 'Enter a rejection reason.';end if;
 if char_length(p_reason)>1000 then raise exception 'Keep the reason under 1000 characters.';end if;
 if p_approve then
 if exists(select 1 from public.platform_orders where status='approved' and payment_reference=r.payment_reference and id<>o.id) then raise exception 'This transaction reference was already approved. Check the actual payment.';end if;
 if o.product='smart_rotation_session' then
 if not exists(select 1 from public.open_plays where id=o.open_play_id and host_id=o.host_id and status in ('draft','published') and ends_at>now()) then raise exception 'The game has ended or was cancelled. Reject and arrange any refund outside Openly.';end if;
 insert into public.premium_feature_purchases(host_id,open_play_id,feature,source_order_id) values(o.host_id,o.open_play_id,'smart_rotation',o.id);
 else
 select greatest(now(),coalesce(max(current_period_end),now())) into period_start from public.host_subscriptions where host_id=o.host_id and status='active';
 insert into public.host_subscriptions(host_id,source_order_id,current_period_start,current_period_end) values(o.host_id,o.id,period_start,period_start+interval '1 month');
 end if;
 end if;
 update public.platform_payment_receipts set status=case when p_approve then 'approved' else 'rejected' end,
 reviewed_at=now(),reviewed_by=u,rejection_reason=case when p_approve then null else btrim(p_reason) end where id=r.id;
 update public.platform_orders set status=case when p_approve then 'approved' else 'rejected' end,
 approved_at=case when p_approve then now() else null end where id=o.id;
end $$;

create function public.openly_cancel_platform_order(p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.platform_orders%rowtype;u uuid:=openly_private.require_user();begin
 select * into o from public.platform_orders where id=p_order and host_id=u for update;
 if not found then raise exception 'Purchase not found.';end if;
 if o.status='cancelled' then return;end if;
 if o.status not in ('awaiting_payment','rejected') then raise exception 'Only unpaid or rejected requests can be cancelled. Contact the admin for payment issues.';end if;
 update public.platform_orders set status='cancelled' where id=o.id;
end $$;

revoke all on function public.openly_has_feature(uuid,text,uuid),public.openly_save_platform_payment(boolean,text,text,text,text),
 public.openly_create_platform_order(uuid,text,uuid),public.openly_submit_platform_receipt(uuid,text,text),
 public.openly_review_platform_receipt(uuid,boolean,text),public.openly_cancel_platform_order(uuid) from public,anon;
grant execute on function public.openly_has_feature(uuid,text,uuid),public.openly_save_platform_payment(boolean,text,text,text,text),
 public.openly_create_platform_order(uuid,text,uuid),public.openly_submit_platform_receipt(uuid,text,text),
 public.openly_review_platform_receipt(uuid,boolean,text),public.openly_cancel_platform_order(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('platform-qrs','platform-qrs',false,5242880,array['image/png','image/jpeg','image/webp']),
 ('platform-proofs','platform-proofs',false,10485760,array['image/png','image/jpeg','image/webp']);
create policy platform_qr_insert on storage.objects for insert to authenticated with check(bucket_id='platform-qrs' and public.openly_is_admin() and split_part(name,'/',1)=auth.uid()::text);
create policy platform_qr_read on storage.objects for select to authenticated using(bucket_id='platform-qrs' and (
 (public.openly_is_admin() and split_part(name,'/',1)=auth.uid()::text)
 or exists(select 1 from public.platform_payment_settings s where s.qr_path=storage.objects.name)
 or exists(select 1 from public.platform_orders o where o.payment_snapshot->>'qr_path'=storage.objects.name)));
create policy platform_proof_insert on storage.objects for insert to authenticated with check(bucket_id='platform-proofs' and split_part(name,'/',1)=auth.uid()::text and exists(
 select 1 from public.platform_orders o where o.id::text=split_part(name,'/',2) and o.host_id=auth.uid() and o.status in ('awaiting_payment','rejected')));
create policy platform_proof_read on storage.objects for select to authenticated using(bucket_id='platform-proofs' and (
 split_part(name,'/',1)=auth.uid()::text or exists(select 1 from public.platform_payment_receipts r where r.object_path=storage.objects.name)));
commit;
select '009 Openly manual Plus payments installed' as result;
