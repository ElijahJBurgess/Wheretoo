-- Exercise the time-independent wrapper through its real fulfillment caller.
-- Elevated setup reads private fixtures; actual reservation, attachment and fulfillment run as service_role.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Include-only rollback fixtures shared by the two Core Ticket Truth Lite suites.
-- Call inside the caller transaction as the elevated fixture role; ends as service_role.
insert into auth.users (id, email) values
  ('a6100000-0000-4000-8000-000000000001', 'integrity-owner@example.invalid'),
  ('a6100000-0000-4000-8000-000000000002', 'integrity-other@example.invalid');

insert into public.organizers (id, display_name) values
  ('a6100000-0000-4000-8000-000000000001', 'Checkout Integrity Fulfillment'),
  ('a6100000-0000-4000-8000-000000000002', 'Checkout Integrity Other');

insert into public.events (
  id, organizer_id, status, moderation_status, title, description, category,
  starts_at, ends_at, venue_name, address_line1, city, region, postal_code,
  country_code, mapbox_feature_id, latitude, longitude, admission_type, published_at
) values (
  'a6200000-0000-4000-8000-000000000001',
  'a6100000-0000-4000-8000-000000000001',
  'published', 'clear', 'Checkout Integrity Fulfillment Event',
  'A synthetic event for rollback-only multi-item fulfillment verification.',
  'community', now() + interval '2 days', now() + interval '2 days 2 hours',
  'Integrity Hall', '1 Integrity Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.checkout-integrity-fulfillment', 37.7936, -122.3958, 'paid', now()
), (
  'a6200000-0000-4000-8000-000000000002',
  'a6100000-0000-4000-8000-000000000002',
  'draft', 'clear', 'Checkout Integrity Other Event',
  'A reference-only event for incoherent ticket fixtures.',
  'community', now() + interval '3 days', now() + interval '3 days 2 hours',
  'Other Hall', '2 Integrity Street', 'San Francisco', 'CA', '94105', 'US',
  'mapbox.checkout-integrity-other', 37.7937, -122.3959, 'paid', null
);

insert into public.ticket_tiers (
  id, event_id, name, unit_amount_minor, currency, quantity_total, status, sort_order
) values
  (
    'a6300000-0000-4000-8000-000000000001',
    'a6200000-0000-4000-8000-000000000001',
    'General Admission', 1001, 'usd', 14, 'active', 1
  ),
  (
    'a6300000-0000-4000-8000-000000000002',
    'a6200000-0000-4000-8000-000000000001',
    'VIP', 999, 'usd', 8, 'active', 2
  ),
  (
    'a6300000-0000-4000-8000-000000000004',
    'a6200000-0000-4000-8000-000000000001',
    'Alternate General Admission', 1001, 'usd', 2, 'active', 3
  ),
  (
    'a6300000-0000-4000-8000-000000000003',
    'a6200000-0000-4000-8000-000000000002',
    'Other Admission', 1500, 'usd', 10, 'active', 1
  );

insert into public.organizer_stripe_accounts (
  organizer_id, stripe_account_id, transfers_status, payouts_status,
  requirements_status, requirements_currently_due_count,
  requirements_past_due_count, last_synced_at
) values (
  'a6100000-0000-4000-8000-000000000001', 'acct_integrityfulfillment',
  'active', 'active', 'clear', 0, 0, now()
);

insert into private.event_risk_disclosures (
  event_id, minimum_age, alcohol_present, cannabis_present,
  explicit_adult_content, gambling_present, weapons_present, high_risk_activity
) values (
  'a6200000-0000-4000-8000-000000000001', 'all_ages',
  false, false, false, false, false, false
);

select set_config('request.jwt.claim.sub', 'a6100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select public.accept_current_event_policies('a6200000-0000-4000-8000-000000000001');
select public.publish_event('a6200000-0000-4000-8000-000000000001');
reset role;

update private.checkout_runtime_control
set checkout_creation_enabled = true
where singleton;


create temporary table probe_orders(kind text,id uuid,session_id text,expires timestamptz,manifest jsonb);
grant all on probe_orders to service_role;
set local role service_role;
insert into probe_orders(kind,id,session_id)
select kind,r.order_id,'cs_test_task25'||kind
from (values ('valid',1),('expired',2),('blocked',3),('cancelled',4))v(kind,n)
cross join lateral public.server_reserve_checkout(
 'a6200000-0000-4000-8000-000000000001',
 '[{"tier_id":"a6300000-0000-4000-8000-000000000001","quantity":2},{"tier_id":"a6300000-0000-4000-8000-000000000002","quantity":1}]',
 'Synthetic Buyer','synthetic-buyer@example.invalid',
 ('3b000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat(n::text,64))r;
select throws_ok('select count(*) from public.orders','42501','permission denied for table orders','service caller still cannot read orders directly');
reset role;
\ir helpers/ticket_manifest.inc
update probe_orders p set expires=o.checkout_expires_at,manifest=pg_temp.ticket_manifest(p.id) from public.orders o where o.id=p.id;
create or replace function pg_temp.record_and_fulfill(
  p_event_suffix text,
  p_payment_suffix text,
  p_order_id uuid,
  p_session_id text,
  p_manifest jsonb default '"auto"'::jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform * from public.server_record_webhook_receipt(
    'evt_' || p_event_suffix,
    'checkout.session.completed', false,
    p_session_id, '2026-07-29.dahlia',
    '2026-09-02 12:00:00+00', repeat('a', 64)
  );

  select pg_catalog.to_jsonb(result) into v_result
  from public.server_fulfill_paid_order(
    'evt_' || p_event_suffix,
    p_order_id,
    p_session_id,
    'pi_' || p_payment_suffix,
    'ch_' || p_payment_suffix,
    'tr_' || p_payment_suffix,
    'fee_' || p_payment_suffix,
    'txn_' || p_payment_suffix,
    'cus_' || p_payment_suffix,
    'payment', 'paid', 'usd',
    3001, 3001, 300, 'acct_integrityfulfillment',
    case when p_manifest = '"auto"'::jsonb then pg_temp.ticket_manifest(p_order_id) else p_manifest end
  ) as result;
  return v_result;
end;
$$;

set local role service_role;
select public.server_attach_checkout_session(id,session_id,expires) from probe_orders;
select is(pg_temp.record_and_fulfill('task25valid','task25valid',id,session_id,manifest)->>'order_status','paid','eligible in-flight order fulfills through unchanged server boundary') from probe_orders where kind='valid';
reset role;

-- Roll back each state mutation inside the probe; emit TAP assertions outside it.
create function pg_temp.probe_restricted_fulfillment(kind text) returns jsonb language plpgsql as $$
declare result jsonb; current_ok boolean; public_ok boolean;
begin
 begin
  if kind='expired' then
   update public.events set starts_at=now()-interval '3 hours',ends_at=now()-interval '1 hour' where id='a6200000-0000-4000-8000-000000000001';
  elsif kind='blocked' then
   update public.events set moderation_status='blocked' where id='a6200000-0000-4000-8000-000000000001';
  else
   update public.events set status='cancelled' where id='a6200000-0000-4000-8000-000000000001';
  end if;
  current_ok:=private.event_has_current_public_eligibility('a6200000-0000-4000-8000-000000000001');
  public_ok:=private.event_is_publicly_eligible('a6200000-0000-4000-8000-000000000001',statement_timestamp());
  set local role service_role;
  select pg_temp.record_and_fulfill('task25'||p.kind,'task25'||p.kind,id,session_id,manifest) into result from probe_orders p where p.kind=probe_restricted_fulfillment.kind;
  reset role;
  result:=result||jsonb_build_object('currentEligible',current_ok,'publicEligible',public_ok);
  raise exception using errcode='PT025',detail=result::text;
 exception when sqlstate 'PT025' then
  get stacked diagnostics result=pg_exception_detail;
 end;
 return result;
end;
$$;
create temporary table expired_probe as select pg_temp.probe_restricted_fulfillment('expired') result;
select is((select result->>'currentEligible' from expired_probe),'true','current authorization remains time-independent');
select is((select result->>'publicEligible' from expired_probe),'false','expired event remains hidden from public reads');
select is((select result->>'order_status' from expired_probe),'paid','accepted in-flight order can fulfill after event end');
select is(pg_temp.probe_restricted_fulfillment('blocked')->>'order_status','requires_review','blocked event does not issue ordinary paid tickets');
select is(pg_temp.probe_restricted_fulfillment('cancelled')->>'order_status','requires_review','cancelled event does not issue ordinary paid tickets');
select * from finish();
rollback;
