begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
\ir spec07_email_fixture.inc
\ir helpers/core_ticket_truth_lite_setup.inc
reset role;
update public.ticket_tiers set quantity_total=30 where id='a6300000-0000-4000-8000-000000000001';
create temporary table recipient_cases(n integer,email text,eligible boolean,id uuid);
insert into recipient_cases(n,email,eligible) values
 (1,'guést@example.invalid',false),
 (2,'guest@example_.invalid',false),
 (3,'guest@-example.invalid',false),
 (4,'guest!vip@example.invalid',true),
 (5,'guest%vip@example.invalid',true),
 (6,$email$g.!#$%&'*+/=?^_`{|}~-@example.invalid$email$,true);
create function pg_temp.issue_recipient_case(p_n integer,p_email text) returns uuid language plpgsql as $fn$
declare o public.orders; order_id uuid; session_id text:='cs_test_recipient'||p_n; suffix text:='recipient'||p_n;
begin
 select r.order_id into order_id from public.server_reserve_checkout('a6200000-0000-4000-8000-000000000001','[{"tier_id":"a6300000-0000-4000-8000-000000000001","quantity":1}]','Recipient Policy Guest',p_email,('b6940000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,encode(extensions.digest(suffix,'sha256'),'hex')) r;
 select * into o from public.orders where id=order_id;
 perform public.server_attach_checkout_session(o.id,session_id,o.checkout_expires_at);
 perform public.server_record_webhook_receipt('evt_'||suffix,'checkout.session.completed',false,session_id,'2026-07-29.dahlia','2026-09-11 12:00:00+00',repeat('a',64));
 perform public.server_fulfill_paid_order('evt_'||suffix,o.id,session_id,'pi_'||suffix,'ch_'||suffix,'tr_'||suffix,'fee_'||suffix,'txn_'||suffix,'cus_'||suffix,'payment','paid','usd',o.subtotal_minor,o.total_minor,o.application_fee_amount_minor,'acct_integrityfulfillment',pg_temp.ticket_manifest(o.id));
 return o.id;
end;
$fn$;
update recipient_cases set id=pg_temp.issue_recipient_case(n,email);
select extensions.is((private.ticket_email_source('paid_order',id)->>'eligible')::boolean,eligible,'paid source canonical email policy for case '||n) from recipient_cases order by n;
select extensions.is(private.ticket_email_source('paid_order',id)->>'reason','invalid_recipient','noncanonical stored paid recipient reports explicit ineligibility case '||n) from recipient_cases where not eligible order by n;
select extensions.is(private.ticket_email_source('paid_order',id)->>'email',email,'accepted canonical punctuation is preserved exactly case '||n) from recipient_cases where eligible order by n;
select extensions.is((select count(*) from private.ticket_email_outbox q join recipient_cases c on q.order_id=c.id where not c.eligible),0::bigint,'invalid recipient sources are not enqueued only to fail later in the worker');
select extensions.is((select count(*) from private.ticket_email_outbox q join recipient_cases c on q.order_id=c.id where c.eligible),3::bigint,'all canonical punctuation sources still enqueue initial delivery');
select extensions.is((select count(*) from public.server_lookup_paid_ticket_collection(encode(extensions.digest('recipient'||n,'sha256'),'hex'))),1::bigint,'email ineligibility does not invalidate existing paid access case '||n) from recipient_cases where not eligible order by n;
select * from extensions.finish();
rollback;
