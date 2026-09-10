-- Synthetic fixture for the disposable local organizer DB only. Run after pgTAP.
begin;
\ir ../../../supabase/tests/database/helpers/core_ticket_truth_lite_setup.inc
select pg_temp.record_and_fulfill('opsbrowser','opsbrowser',id,session_id) from fulfillment_orders where kind='clean';
reset role;
update public.organizers set onboarding_completed_at=now() where id='a6100000-0000-4000-8000-000000000001';
set local session_replication_role=replica;
update public.events set title='Sunset Rooftop Sessions',venue_name='Lakeview Rooftop',city='Oakland' where id='a6200000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
commit;
