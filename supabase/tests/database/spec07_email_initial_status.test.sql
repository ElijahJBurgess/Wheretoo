begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
\ir spec07_email_fixture.inc
select pg_temp.register(1,2);
\ir helpers/core_ticket_truth_lite_setup.inc
select pg_temp.record_and_fulfill('initialsummary','initialsummary',id,session_id) from fulfillment_orders where kind='clean';
reset role;
create temp table buyer_sources(kind text,id uuid,owner_id uuid,event_id uuid,access_hash text,request_id uuid);
insert into buyer_sources select 'paid_order',id,'a6100000-0000-4000-8000-000000000001'::uuid,'a6200000-0000-4000-8000-000000000001'::uuid,repeat('1',64),'b6920000-0000-4000-8000-000000000001'::uuid from fulfillment_orders where kind='clean';
insert into buyer_sources select 'free_registration',id,organizer_id,event_id,access_hash,'b6920000-0000-4000-8000-000000000002'::uuid from public.free_registrations where request_id='b6300000-0000-4000-8000-000000000001';
update private.ticket_email_outbox q set state='accepted',provider_id='initial-'||q.id::text,dispatch_count=1,first_possible_dispatch_at=now()-interval '1 hour',observation='delivered'
from buyer_sources s where q.purpose='initial' and (q.order_id=s.id or q.registration_id=s.id);
insert into private.ticket_email_outbox(purpose,order_id,registration_id,requested_by,request_id,state,dispatch_count,first_possible_dispatch_at,created_at)
select 'resend',case when kind='paid_order' then id end,case when kind='free_registration' then id end,owner_id,request_id,case when kind='paid_order' then 'failed' else 'unknown' end,1,now()-interval '1 minute',now()+interval '1 second' from buyer_sources;
select extensions.is(public.server_ticket_email_confirmation_status(kind,access_hash,repeat('e',64)),jsonb_build_object('state','accepted','observation','delivered'),kind||' buyer summary remains initial Accepted after later resend') from buyer_sources;
select set_config('request.jwt.claim.sub','a6100000-0000-4000-8000-000000000001',true);
select extensions.is((select public.get_ticket_email_resend_status(event_id,kind,id,request_id)->>'state' from buyer_sources where kind='paid_order'),'failed','paid organizer exact-request reader retains later resend failure');
select set_config('request.jwt.claim.sub','b6100000-0000-4000-8000-000000000001',true);
select extensions.is((select public.get_ticket_email_resend_status(event_id,kind,id,request_id)->>'state' from buyer_sources where kind='free_registration'),'unknown','free organizer exact-request reader retains later resend uncertainty');
select * from extensions.finish();
rollback;
