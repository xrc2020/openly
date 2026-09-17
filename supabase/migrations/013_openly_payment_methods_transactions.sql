-- Multiple Openly receiving accounts. Participant-to-host payments are unchanged.
begin;
create table public.platform_payment_methods (
 provider text primary key check(provider in ('gcash','maribank','maya','bank_transfer')),
 enabled boolean not null default false,
 account_name text not null check(char_length(btrim(account_name)) between 1 and 160),
 account_number text not null check(char_length(btrim(account_number)) between 1 and 80),
 qr_path text not null,updated_at timestamptz not null default now()
);
-- Preserve the previous provider exactly: a generic bank is not assumed to be MariBank.
insert into public.platform_payment_methods(provider,enabled,account_name,account_number,qr_path,updated_at)
select provider,enabled,account_name,account_number,qr_path,updated_at from public.platform_payment_settings;
alter table public.platform_payment_methods enable row level security;
revoke all on public.platform_payment_methods from public,anon,authenticated;
grant select on public.platform_payment_methods to authenticated;
create policy platform_methods_read on public.platform_payment_methods for select to authenticated using(enabled or public.openly_is_admin());

create function public.openly_save_platform_method(p_enabled boolean,p_provider text,p_account_name text,p_account_number text,p_qr_path text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.openly_is_admin() then raise exception 'Admin access required.';end if;
 if p_enabled is null or p_provider is null or p_provider not in ('gcash','maribank','maya','bank_transfer') then raise exception 'Choose a valid payment method.';end if;
 if nullif(btrim(p_account_name),'') is null or nullif(btrim(p_account_number),'') is null then raise exception 'Enter the receiving account name and number.';end if;
 if p_qr_path is null or not exists(select 1 from storage.objects where bucket_id='platform-qrs' and name=p_qr_path)
 or not (split_part(p_qr_path,'/',1)=auth.uid()::text or exists(select 1 from public.platform_payment_methods where provider=p_provider and qr_path=p_qr_path)) then
 raise exception 'Upload a QR for this payment method first.';end if;
 insert into public.platform_payment_methods(provider,enabled,account_name,account_number,qr_path)
 values(p_provider,p_enabled,btrim(p_account_name),btrim(p_account_number),p_qr_path)
 on conflict(provider) do update set enabled=excluded.enabled,account_name=excluded.account_name,
 account_number=excluded.account_number,qr_path=excluded.qr_path,updated_at=now();
end $$;
-- Old clients cannot overwrite multiple accounts through the former singleton.
create or replace function public.openly_save_platform_payment(p_enabled boolean,p_provider text,p_account_name text,p_account_number text,p_qr_path text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.openly_save_platform_method(p_enabled,p_provider,p_account_name,p_account_number,p_qr_path);
end $$;

create function public.openly_create_platform_order(p_request uuid,p_product text,p_event uuid,p_method text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=openly_private.require_user();settings public.platform_payment_methods%rowtype;o public.platform_orders%rowtype;result uuid;
begin
 if p_request is null or p_product is null or p_product not in ('smart_rotation_session','openly_plus_monthly') then raise exception 'Choose a valid purchase.';end if;
 perform pg_advisory_xact_lock(hashtextextended('platform-order:'||u::text,0));
 select * into o from public.platform_orders where id=p_request;
 if found then
 if o.host_id<>u or o.product<>p_product or o.open_play_id is distinct from p_event or o.payment_snapshot->>'provider' is distinct from p_method then raise exception 'This request ID is already in use.';end if;
 return o.id;end if;
 if not exists(select 1 from public.profiles where id=u and onboarding_completed_at is not null) then raise exception 'Complete your profile before purchasing.';end if;
 if p_product='smart_rotation_session' then
 if not exists(select 1 from public.open_plays where id=p_event and host_id=u and status in ('draft','published') and ends_at>now()) then raise exception 'Choose one of your upcoming or active games.';end if;
 if openly_private.has_feature(u,'smart_rotation',p_event) then raise exception 'Smart Rotation is already included for this game.';end if;
 elsif p_event is not null then raise exception 'Monthly Plus is not tied to a game.';end if;
 -- Return an existing open request without changing its receiving account or QR.
 select id into result from public.platform_orders where host_id=u and product=p_product and open_play_id is not distinct from p_event
 and status in ('awaiting_payment','pending_review','rejected');
 if result is not null then return result;end if;
 select * into settings from public.platform_payment_methods where provider=p_method and enabled for share;
 if not found then raise exception 'This payment method is unavailable. Refresh and choose an enabled method.';end if;
 insert into public.platform_orders(id,host_id,product,open_play_id,amount,payment_snapshot)
 values(p_request,u,p_product,p_event,case when p_product='smart_rotation_session' then 39 else 399 end,
 jsonb_build_object('provider',settings.provider,'account_name',settings.account_name,'account_number',settings.account_number,'qr_path',settings.qr_path));
 return p_request;
end $$;
-- Compatibility for a previously open browser tab. New checkout explicitly chooses a method.
create or replace function public.openly_create_platform_order(p_request uuid,p_product text,p_event uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare method text;begin
 select payment_snapshot->>'provider' into method from public.platform_orders where id=p_request and host_id=auth.uid();
 if method is null then select provider into method from public.platform_payment_methods where enabled order by (provider='gcash') desc,provider limit 1;end if;
 return public.openly_create_platform_order(p_request,p_product,p_event,method);
end $$;

drop policy platform_qr_read on storage.objects;
create policy platform_qr_read on storage.objects for select to authenticated using(bucket_id='platform-qrs' and (
 public.openly_is_admin()
 or exists(select 1 from public.platform_payment_methods m where m.enabled and m.qr_path=storage.objects.name)
 or exists(select 1 from public.platform_orders o where o.payment_snapshot->>'qr_path'=storage.objects.name)));

create function public.openly_admin_transactions(p_page integer default 0,p_status text default 'all',p_method text default 'all')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if not public.openly_is_admin() then raise exception 'Admin access required.';end if;
 if p_page is null or p_page<0 or p_page>1000000 or p_status is null or p_status not in ('all','approved','pending_review','awaiting_payment','rejected','cancelled')
 or p_method is null or p_method not in ('all','gcash','maribank','maya','bank_transfer') then raise exception 'Invalid transaction filter.';end if;
 with filtered as (
 select o.*,jsonb_build_object('display_name',p.display_name) as host,
 case when g.id is null then null else jsonb_build_object('title',g.title) end as game,
 (select jsonb_build_object('display_name',rp.display_name,'reviewed_at',r.reviewed_at)
 from public.platform_payment_receipts r left join public.profiles rp on rp.id=r.reviewed_by
 where r.order_id=o.id and r.reviewed_at is not null order by r.reviewed_at desc,r.id limit 1) as review
 from public.platform_orders o join public.profiles p on p.id=o.host_id left join public.open_plays g on g.id=o.open_play_id
 where (p_status='all' or o.status=p_status) and (p_method='all' or o.payment_snapshot->>'provider'=p_method)
 ), page as (select * from filtered order by created_at desc,id limit 20 offset p_page*20)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id) from page),'[]'::jsonb),
 'count',(select count(*) from filtered),'summary',(select jsonb_build_object(
 'received',coalesce(sum(amount) filter(where status='approved'),0),'approved_count',count(*) filter(where status='approved'),
 'plus',coalesce(sum(amount) filter(where status='approved' and product='openly_plus_monthly'),0),
 'session',coalesce(sum(amount) filter(where status='approved' and product='smart_rotation_session'),0),
 'pending',count(*) filter(where status='pending_review'),
 'gcash',coalesce(sum(amount) filter(where status='approved' and payment_snapshot->>'provider'='gcash'),0),
 'maribank',coalesce(sum(amount) filter(where status='approved' and payment_snapshot->>'provider'='maribank'),0),
 'other',coalesce(sum(amount) filter(where status='approved' and payment_snapshot->>'provider' not in ('gcash','maribank')),0)
 ) from public.platform_orders)) into result;
 return result;
end $$;
revoke all on function public.openly_save_platform_method(boolean,text,text,text,text),public.openly_create_platform_order(uuid,text,uuid,text),public.openly_admin_transactions(integer,text,text) from public,anon;
grant execute on function public.openly_save_platform_method(boolean,text,text,text,text),public.openly_create_platform_order(uuid,text,uuid,text),public.openly_admin_transactions(integer,text,text) to authenticated;
commit;
select '013 Openly payment methods and transactions installed' as result;
