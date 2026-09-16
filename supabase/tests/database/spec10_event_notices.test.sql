begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir helpers/spec09_refund_setup.inc
select pg_temp.record_and_fulfill('spec10notice','spec10notice',id,session_id) from fulfillment_orders;
reset role;
select public.cancel_owned_event('a6200000-0000-4000-8000-000000000001');
create function pg_temp.preview() returns jsonb language sql as $$select public.preview_owned_event_notice('a6200000-0000-4000-8000-000000000001','event_cancellation')$$;
select is(pg_temp.preview()->>'eligibleMessages','1','one cancellation message for a three-ticket order');
select is((select count(*) from private.ticket_email_outbox),0::bigint,'preview is read only');
create temp table reviewed as select pg_temp.preview() p;
select public.submit_owned_event_notice('a6200000-0000-4000-8000-000000000001','event_cancellation',(select p->>'previewToken' from reviewed),'a6500000-0000-4000-8000-000000000010');
select is((select count(*) from private.ticket_email_outbox where purpose='event_cancellation'),1::bigint,'deliberate submit enqueues one canonical source');
select public.submit_owned_event_notice('a6200000-0000-4000-8000-000000000001','event_cancellation',(select p->>'previewToken' from reviewed),'a6500000-0000-4000-8000-000000000010');
select is((select count(*) from private.ticket_email_outbox where purpose='event_cancellation'),1::bigint,'ambiguous submit replay cannot duplicate');
select is(pg_temp.preview()->>'eligibleMessages','0','reviewed catch-up excludes previously submitted source');
select is((select count(*) from private.order_refund_operations),0::bigint,'notice never dispatches refund');
select * from finish();rollback;
