begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email) values
 ('a9290000-0000-4000-8000-000000000001','local-publish-owner@example.invalid'),
 ('a9290000-0000-4000-8000-000000000002','local-publish-moderator@example.invalid');
insert into public.organizers(id,display_name) values('a9290000-0000-4000-8000-000000000001','Local Community');
insert into private.staff_roles(user_id,role,active,granted_by) values('a9290000-0000-4000-8000-000000000002','moderator',true,'a9290000-0000-4000-8000-000000000002');
insert into public.organizer_stripe_accounts(organizer_id,stripe_account_id,transfers_status,payouts_status,requirements_status,requirements_currently_due_count,requirements_past_due_count,last_synced_at)
values('a9290000-0000-4000-8000-000000000001','acct_localpublishsql','active','active','clear',0,0,now());
insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type)
select ('a9291000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a9290000-0000-4000-8000-000000000001','Community gathering',
'A calm community gathering for neighbors and local makers.','community',now()+interval '3 days',now()+interval '3 days 2 hours','Local Hall','1 Market St','San Francisco','CA','94105','US','mapbox.local-proof',37.7936,-122.3958,case when n=2 then 'paid' else 'free' end
from generate_series(1,7) n;
insert into public.ticket_tiers(event_id,name,unit_amount_minor,currency,quantity_total,status,sort_order)
values('a9291000-0000-4000-8000-000000000002','Admission',1200,'usd',30,'draft',1);

create function pg_temp.e(n integer) returns uuid language sql as $$select ('a9291000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.requirements(n integer,risk boolean default false) returns void language plpgsql as $$begin
 perform public.save_owned_event_requirements(pg_temp.e(n),jsonb_build_object('minimum_age','all_ages','alcohol_present',false,'cannabis_present',false,'explicit_adult_content',false,'gambling_present',false,'weapons_present',false,'high_risk_activity',risk));
end;$$;
create function pg_temp.publish(n integer) returns jsonb language plpgsql as $$begin
 perform public.accept_current_event_policies(pg_temp.e(n));
 return public.publish_event_if_current(pg_temp.e(n),public.get_owned_event_change_context(pg_temp.e(n))->>'context_token');
end;$$;
create function pg_temp.edit(n integer,title text) returns void language plpgsql as $$declare c jsonb; begin
 c:=public.get_owned_event_change_context(pg_temp.e(n));
 perform public.save_owned_event_revision_if_current(pg_temp.e(n),((c->'current_saved'->'facts')-'disclosures')||jsonb_build_object('title',title),c->>'context_token');
end;$$;

select set_config('request.jwt.claim.sub','a9290000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.requirements(n) from generate_series(1,6) n;
select pg_temp.edit(n,'Updated community gathering') from generate_series(1,6) n;
select lives_ok($$select pg_temp.publish(1)$$,'clean free draft publishes after multiple owner revisions');
select lives_ok($$select pg_temp.publish(2)$$,'clean paid draft publishes after multiple owner revisions');
reset role;
select is((select moderation_status from public.events where id=pg_temp.e(1)),'clear','repeated organizer edits do not trap clean free publication in review');
select is((select moderation_status from public.events where id=pg_temp.e(2)),'clear','repeated organizer edits do not trap clean paid publication in review');
select ok(private.event_is_publicly_eligible(pg_temp.e(1),now()),'free publication immediately opens canonical public eligibility');
select ok(private.event_is_publicly_eligible(pg_temp.e(2),now()),'paid publication immediately opens canonical public eligibility');
select is((select count(*) from public.get_public_event(pg_temp.e(1))),1::bigint,'anonymous public projection can expose clean event');
select is((select count(*) from private.event_moderation_actions where event_id=pg_temp.e(1) and action='clear'),1::bigint,'clear is audited exactly once');

-- Worker result from before synchronous clear cannot reverse the new generation.
update private.event_moderation_evaluations set status='processing',attempt_count=1,started_at=clock_timestamp()
where event_id=pg_temp.e(1) and status='queued';
select public.server_apply_moderation_evaluation(id,content_revision,input_sha256,queued_moderation_version,'review_required','high',array['other'],null,null)
from private.event_moderation_evaluations where event_id=pg_temp.e(1) order by created_at,id;
select is((select moderation_status from public.events where id=pg_temp.e(1)),'clear','older worker results cannot overwrite synchronous clear');

-- A moderator's hold survives later owner edits; history cannot be laundered.
create temp table hold_snapshot as select id,content_revision,private.compute_event_input_sha256(id) input_sha256,moderation_version from public.events where id=pg_temp.e(3);
grant select on hold_snapshot to authenticated;
select set_config('request.jwt.claim.sub','a9290000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.moderate_event(id,content_revision,input_sha256,moderation_version,'hold','user_report',null) from hold_snapshot;
reset role;
select set_config('request.jwt.claim.sub','a9290000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.edit(3,'Another calm community gathering');
select pg_temp.publish(3);
reset role;
select is((select moderation_status from public.events where id=pg_temp.e(3)),'under_review','human hold remains authoritative across subsequent owner revisions');
select ok(not private.event_is_publicly_eligible(pg_temp.e(3),now()),'held event remains private');

-- Elevated disclosure cannot use provenance as a substitute for risk checks.
set local role authenticated;
select pg_temp.requirements(4,true);
select pg_temp.publish(4);
reset role;
select is((select moderation_status from public.events where id=pg_temp.e(4)),'under_review','elevated risk remains held after repeated owner edits');

-- A real system publish hold must survive even when the owner removes the risk.
set local role authenticated;
select pg_temp.requirements(5,true);
select pg_temp.publish(5);
select pg_temp.requirements(5,false);
select pg_temp.publish(5);
reset role;
select is((select moderation_status from public.events where id=pg_temp.e(5)),'under_review','system risk hold survives later all-No revision');

set local role authenticated;
select pg_temp.edit(6,'Gambling community gathering');
select pg_temp.publish(6);
reset role;
select is((select moderation_status from public.events where id=pg_temp.e(6)),'under_review','all-No does not bypass contextual text risk');

-- Synthetic unknown provenance: never infer owner authority from status alone.
update public.events set moderation_status='under_review' where id=pg_temp.e(7);
set local role authenticated;
select pg_temp.requirements(7);
select pg_temp.edit(7,'Another community gathering');
select pg_temp.publish(7);
reset role;
select is((select moderation_status from public.events where id=pg_temp.e(7)),'under_review','missing hold provenance fails closed');
select ok(not has_function_privilege('authenticated',to_regprocedure('private.event_has_only_organizer_edit_hold(uuid)'),'execute'),'browser cannot invoke hold provenance helper');
select ok(not has_function_privilege('service_role',to_regprocedure('private.event_has_only_organizer_edit_hold(uuid)'),'execute'),'service API has no direct helper authority');

-- Duplicate publication is idempotent and no extra clear/history is invented.
set local role authenticated;
select pg_temp.publish(1);
reset role;
select is((select count(*) from private.event_moderation_actions where event_id=pg_temp.e(1) and action='clear'),1::bigint,'repeat publish adds no duplicate clear');
set local role authenticated;
select pg_temp.edit(1,'Community gathering revision '||n) from generate_series(1,20) n;
select pg_temp.publish(1);
reset role;
select ok(private.event_is_publicly_eligible(pg_temp.e(1),now()),'long uninterrupted owner edit chain still takes the immediate canonical path');
select set_config('request.jwt.claim.sub','a9290000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select public.publish_event_if_current(pg_temp.e(1),'foreign')$$,'P0001','EVENT_NOT_FOUND','foreign organizer cannot publish');
reset role;
select * from finish();
rollback;
