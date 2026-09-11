-- Disposable local browser proof, guarded by the harness's fixed loopback DB.
begin;
do $$ begin
 if exists(select 1 from auth.users where id not in ('a6100000-0000-4000-8000-000000000001','a6100000-0000-4000-8000-000000000002'))
 then raise exception 'Non-fixture database refused'; end if;
end $$;
truncate public.events, public.organizers, auth.users cascade;
delete from public.stripe_webhook_events where stripe_event_id like 'evt_opsbrowser%';
\ir ../../../supabase/tests/database/helpers/core_ticket_truth_lite_setup.inc
-- The same opaque credential derivation as production, with an intentionally
-- public test-only key. Hashes are issued through the existing fulfillment writer.
create or replace function pg_temp.ticket_manifest(p_order_id uuid)
returns jsonb language sql set search_path='' as $$
 select jsonb_agg(jsonb_build_object(
 'order_item_id', i.id, 'unit_sequence', u.n, 'admission_label', i.tier_name,
 'credential_hash', encode(extensions.digest('wta1_' || translate(rtrim(encode(
 extensions.hmac(convert_to('wheretoo:paid-admission:lite:v1' || chr(10) || i.id::text || chr(10) || u.n::text,'UTF8'),decode(repeat('ab',32),'hex'),'sha256'), 'base64'),'='),'+/','-_'),'sha256'),'hex')) order by i.id,u.n)
 from public.order_items i cross join lateral generate_series(1,i.quantity) u(n) where i.order_id=p_order_id;
$$;
select pg_temp.record_and_fulfill('opsbrowserqr','opsbrowserqr',id,session_id) from fulfillment_orders where kind='clean';
reset role;
update public.organizers set onboarding_completed_at=now() where id='a6100000-0000-4000-8000-000000000001';
set local session_replication_role=replica;
update public.events set title='Sunset Rooftop Sessions',venue_name='Lakeview Rooftop',city='Oakland' where id='a6200000-0000-4000-8000-000000000001';
insert into public.events(id,organizer_id,status,admission_type,title,starts_at,ends_at,published_at)
values('a6200000-0000-4000-8000-000000000003','a6100000-0000-4000-8000-000000000001','published','paid','Another owned event',now()+interval '2 days',now()+interval '2 days 2 hours',now());
set local session_replication_role=origin;
commit;
