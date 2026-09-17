begin;
alter table public.platform_payment_methods drop constraint platform_payment_methods_provider_check;
alter table public.platform_payment_methods add constraint platform_payment_methods_provider_check check(provider in ('gcash','maribank','maya','bank_transfer','paymongo'));
alter table public.platform_payment_methods add column session_url text,add column plus_url text;
alter table public.platform_payment_methods add constraint paymongo_urls_valid check(provider<>'paymongo' or
 (session_url is not null and plus_url is not null and session_url ~ '^https://paymongo[.]page/l/[A-Za-z0-9_-]+$' and plus_url ~ '^https://paymongo[.]page/l/[A-Za-z0-9_-]+$'));
insert into public.platform_payment_methods(provider,enabled,account_name,account_number,qr_path,session_url,plus_url)
values('paymongo',true,'Openly','Hosted payment page','','https://paymongo.page/l/openly-sessionunlock','https://paymongo.page/l/openlyplus');
create function public.openly_save_paymongo_links(p_enabled boolean,p_session_url text,p_plus_url text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.openly_is_admin() then raise exception 'Admin access required.';end if;
 if p_enabled is null or p_session_url is null or p_plus_url is null or
 btrim(p_session_url) !~ '^https://paymongo[.]page/l/[A-Za-z0-9_-]+$' or btrim(p_plus_url) !~ '^https://paymongo[.]page/l/[A-Za-z0-9_-]+$' then raise exception 'Enter valid https://paymongo.page/l/ payment links for both plans.';end if;
 update public.platform_payment_methods set enabled=p_enabled,session_url=btrim(p_session_url),plus_url=btrim(p_plus_url),updated_at=now() where provider='paymongo';
end $$;
revoke all on function public.openly_save_paymongo_links(boolean,text,text) from public,anon;
grant execute on function public.openly_save_paymongo_links(boolean,text,text) to authenticated;
create or replace function public.openly_create_platform_order(p_request uuid,p_product text,p_event uuid,p_method text) returns uuid
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
 jsonb_build_object('provider',settings.provider,'account_name',settings.account_name,'account_number',settings.account_number,'qr_path',settings.qr_path,'payment_url',case when settings.provider='paymongo' then case when p_product='smart_rotation_session' then settings.session_url else settings.plus_url end else null end));
 return p_request;
end $$;
create or replace function public.openly_admin_transactions(p_page integer default 0,p_status text default 'all',p_method text default 'all')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if not public.openly_is_admin() then raise exception 'Admin access required.';end if;
 if p_page is null or p_page<0 or p_page>1000000 or p_status is null or p_status not in ('all','approved','pending_review','awaiting_payment','rejected','cancelled')
 or p_method is null or p_method not in ('all','gcash','maribank','maya','bank_transfer','paymongo') then raise exception 'Invalid transaction filter.';end if;
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
commit;
select '017 Openly PayMongo payment links installed' as result;
