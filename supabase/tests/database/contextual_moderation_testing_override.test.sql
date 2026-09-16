begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
-- Fixture policy state is rolled back with all test changes.
update private.organizer_policy_release_settings set environment = 'unconfigured';
select has_function('public', 'server_set_contextual_moderation_testing_override', array['boolean', 'text'],
  'testing override has an explicit server-only configuration boundary');
select function_privs_are('public', 'server_set_contextual_moderation_testing_override', array['boolean', 'text'], 'authenticated', array[]::text[], 'organizers cannot change testing configuration');
select function_privs_are('public', 'server_set_contextual_moderation_testing_override', array['boolean', 'text'], 'anon', array[]::text[], 'anonymous callers cannot change testing configuration');
select function_privs_are('public', 'server_set_contextual_moderation_testing_override', array['boolean', 'text'], 'service_role', array['EXECUTE'], 'service-only setter is available');
select is((select skip_contextual_moderation_for_testing from private.moderation_testing_settings), false, 'override defaults OFF');
insert into auth.users (id, email) values ('19000000-0000-4000-8000-000000000151', 'testing-moderation@example.invalid');
insert into public.organizers (id, display_name) values ('19000000-0000-4000-8000-000000000151', 'Testing moderation');
insert into public.events (id, organizer_id, admission_type) values ('29000000-0000-4000-8000-000000000151', '19000000-0000-4000-8000-000000000151', 'paid');
insert into private.event_risk_disclosures (event_id, minimum_age, alcohol_present, cannabis_present, explicit_adult_content, gambling_present, weapons_present, high_risk_activity) values ('29000000-0000-4000-8000-000000000151', 'all_ages', false, false, false, false, false, false);
select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000151', 'full_review', '19000000-0000-4000-8000-000000000151');
select is((select moderation_status from public.events where id='29000000-0000-4000-8000-000000000151'), 'under_review', 'default OFF retains automatic edit hold');
select is((select count(*) from private.event_moderation_evaluations where event_id='29000000-0000-4000-8000-000000000151' and status='queued'), 1::bigint, 'default OFF retains contextual queue');
set local role service_role;
select throws_ok($$select public.server_set_contextual_moderation_testing_override(true, '')$$, '22023', 'MODERATION_TESTING_REASON_REQUIRED', 'configuration requires an audit reason');
select lives_ok($$select public.server_set_contextual_moderation_testing_override(true, 'Local rollback test')$$, 'service enables explicitly');
reset role;
select is((select moderation_status from public.events where id='29000000-0000-4000-8000-000000000151'), 'under_review', 'enabling itself does not clear existing holds');
select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000151', 'full_review', '19000000-0000-4000-8000-000000000151');
select is((select moderation_status from public.events where id='29000000-0000-4000-8000-000000000151'), 'not_evaluated', 'eligible draft edit avoids automatic contextual hold');
select is((select count(*) from private.event_moderation_evaluations where event_id='29000000-0000-4000-8000-000000000151' and status in ('queued','processing')), 0::bigint, 'next edit supersedes pending contextual work without a replacement');
select is((select count(*) from private.event_moderation_evaluations where event_id='29000000-0000-4000-8000-000000000151' and status='succeeded'), 0::bigint, 'override never manufactures provider approval');
select results_eq($$select content_revision, moderated_revision, publicly_authorized_revision from public.events where id='29000000-0000-4000-8000-000000000151'$$, $$values (3::bigint, null::bigint, null::bigint)$$, 'edit remains unapproved and revision-bound');
select throws_ok($$select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000151', 'full_review', '19000000-0000-4000-8000-000000000152')$$, 'P0001', 'EVENT_NOT_FOUND', 'override cannot bypass ownership');
select set_config('request.jwt.claim.sub', '19000000-0000-4000-8000-000000000151', true);
set local role authenticated;
select throws_ok($$select public.publish_event('29000000-0000-4000-8000-000000000151')$$, 'P0001', 'POLICY_ENVIRONMENT_UNCONFIGURED', 'testing override does not configure or bypass publication policy');
reset role;
update public.events set moderation_status='blocked' where id='29000000-0000-4000-8000-000000000151';
select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000151', 'full_review', '19000000-0000-4000-8000-000000000151');
select is((select moderation_status from public.events where id='29000000-0000-4000-8000-000000000151'), 'blocked', 'explicit blocks survive enabled override');
update public.events set moderation_status='under_review' where id='29000000-0000-4000-8000-000000000151';
select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000151', 'full_review', '19000000-0000-4000-8000-000000000151');
select is((select moderation_status from public.events where id='29000000-0000-4000-8000-000000000151'), 'under_review', 'unproven review hold is never cleared');
-- Simulate an explicit system moderation hold at the current revision.
insert into private.event_moderation_actions (event_id, content_revision, input_sha256,
  actor_type, source, action, previous_status, new_status, previous_public_history_status,
  new_public_history_status, reason_code, moderation_version)
select id, content_revision, private.compute_event_input_sha256(id), 'system', 'evaluation',
  'hold', 'under_review', 'under_review', public_history_status, public_history_status,
  'unsafe_activity', moderation_version from public.events where id='29000000-0000-4000-8000-000000000151';
insert into private.event_reports (event_id, content_revision, input_sha256, reporter_fingerprint, reason)
select id, content_revision, private.compute_event_input_sha256(id), repeat('a',64), 'unsafe'
from public.events where id='29000000-0000-4000-8000-000000000151';
select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000151', 'full_review', '19000000-0000-4000-8000-000000000151');
select is((select moderation_status from public.events where id='29000000-0000-4000-8000-000000000151'), 'under_review', 'system/report hold survives an organizer edit');
select is((select count(*) from private.event_moderation_evaluations where event_id='29000000-0000-4000-8000-000000000151' and status='queued'), 1::bigint, 'legitimate hold retains ordinary review work');
update public.events set moderation_status='removed' where id='29000000-0000-4000-8000-000000000151';
select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000151', 'full_review', '19000000-0000-4000-8000-000000000151');
select is((select moderation_status from public.events where id='29000000-0000-4000-8000-000000000151'), 'removed', 'removal survives enabled override');
update public.events set moderation_status='clear', moderated_revision=content_revision where id='29000000-0000-4000-8000-000000000151';
select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000151', 'deterministic_only', '19000000-0000-4000-8000-000000000151');
select is((select moderation_status from public.events where id='29000000-0000-4000-8000-000000000151'), 'under_review', 'failed deterministic validation is not bypassed');
select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000151', 'full_review', '19000000-0000-4000-8000-000000000151');
select is((select moderation_status from public.events where id='29000000-0000-4000-8000-000000000151'), 'under_review', 'deterministic hold cannot masquerade as an automatic contextual hold');
update private.organizer_policy_release_settings set environment = 'production';
set local role service_role;
select throws_ok($$select public.server_set_contextual_moderation_testing_override(true, 'Rejected production request')$$, 'P0001', 'MODERATION_TESTING_PRODUCTION_FORBIDDEN', 'production cannot enable override');
reset role;
update public.events set moderation_status='not_evaluated', moderated_revision=null where id='29000000-0000-4000-8000-000000000151';
select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000151', 'full_review', '19000000-0000-4000-8000-000000000151');
select is((select moderation_status from public.events where id='29000000-0000-4000-8000-000000000151'), 'under_review', 'production policy makes an already-enabled flag inert');
update private.organizer_policy_release_settings set environment = 'unconfigured';
-- Publication proof uses only transaction-local development policy fixtures.
update private.organizer_policy_requirements set policy_version_id = case policy_kind
  when 'organizer_terms' then 'dev-organizer-terms-v1' else 'dev-event-policy-v1' end;
select private.configure_policy_environment('development');
insert into public.events (id, organizer_id, title, description, category, starts_at, ends_at,
 timezone, address_line1, city, region, postal_code, country_code, mapbox_feature_id,
 latitude, longitude, admission_type)
values ('29000000-0000-4000-8000-000000000152', '19000000-0000-4000-8000-000000000151',
 'Community picnic', 'An ordinary neighborhood gathering in the community park.', 'community',
 now() + interval '2 days', now() + interval '2 days 2 hours', 'America/Los_Angeles',
 '1 Market Street', 'San Francisco', 'CA', '94105', 'US', 'mapbox.testing-override', 37.7936, -122.3958, 'free');
insert into private.event_risk_disclosures (event_id, minimum_age, alcohol_present, cannabis_present,
 explicit_adult_content, gambling_present, weapons_present, high_risk_activity)
values ('29000000-0000-4000-8000-000000000152', 'all_ages', false, false, false, false, false, false);
select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000152', 'full_review', '19000000-0000-4000-8000-000000000151');
set local role authenticated;
select throws_ok($$select public.publish_event('29000000-0000-4000-8000-000000000152')$$, 'P0001', 'EVENT_POLICY_ACCEPTANCE_REQUIRED', 'enabled override still requires exact consent');
select lives_ok($$select public.accept_current_event_policies('29000000-0000-4000-8000-000000000152')$$, 'eligible organizer can accept current policy');
select lives_ok($$select public.publish_event('29000000-0000-4000-8000-000000000152')$$, 'eligible event publishes without a contextual provider');
reset role;
select results_eq($$select status, moderation_status, content_revision=moderated_revision,
 content_revision=publicly_authorized_revision from public.events where id='29000000-0000-4000-8000-000000000152'$$,
 $$values ('published'::text, 'clear'::text, true, true)$$, 'publication performs real deterministic clearance and exact authorization');
select is((select count(*) from private.event_moderation_evaluations where event_id='29000000-0000-4000-8000-000000000152' and source='contextual'), 0::bigint, 'successful low-risk publish never needs contextual queue');
select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000152', 'full_review', '19000000-0000-4000-8000-000000000151');
select is((select moderation_status from public.events where id='29000000-0000-4000-8000-000000000152'), 'under_review', 'already public edits retain ordinary review');
insert into public.events (id, organizer_id, title, description, category, starts_at, ends_at,
 timezone, address_line1, city, region, postal_code, country_code, mapbox_feature_id,
 latitude, longitude, admission_type)
select '29000000-0000-4000-8000-000000000153', organizer_id, 'Risk disclosed gathering',
 description, category, starts_at, ends_at, timezone, address_line1, city, region,
 postal_code, country_code, mapbox_feature_id, latitude, longitude, 'free'
from public.events where id='29000000-0000-4000-8000-000000000152';
insert into private.event_risk_disclosures (event_id, minimum_age, alcohol_present, cannabis_present,
 explicit_adult_content, gambling_present, weapons_present, high_risk_activity)
values ('29000000-0000-4000-8000-000000000153', 'all_ages', false, false, false, false, false, true);
select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000153', 'full_review', '19000000-0000-4000-8000-000000000151');
set local role authenticated;
select public.accept_current_event_policies('29000000-0000-4000-8000-000000000153');
select lives_ok($$select public.publish_event('29000000-0000-4000-8000-000000000153')$$, 'risk publication is evaluated at unchanged canonical boundary');
reset role;
select is((select moderation_status from public.events where id='29000000-0000-4000-8000-000000000153'), 'under_review', 'disclosed high risk still requires moderation with override enabled');
select is((select private.event_meets_public_candidate('29000000-0000-4000-8000-000000000153', statement_timestamp())), false, 'risk-held event is not publicly eligible');
update private.organizer_policy_release_settings set environment = 'unconfigured';
set local role service_role;
select lives_ok($$select public.server_set_contextual_moderation_testing_override(false, 'Restore ordinary moderation')$$, 'service disables explicitly');
reset role;
update public.events set moderation_status='not_evaluated' where id='29000000-0000-4000-8000-000000000151';
select private.invalidate_event_public_revision('29000000-0000-4000-8000-000000000151', 'full_review', '19000000-0000-4000-8000-000000000151');
select is((select moderation_status from public.events where id='29000000-0000-4000-8000-000000000151'), 'under_review', 'OFF restores automatic review on the next edit');
select is((select count(*) from private.moderation_testing_setting_changes), 2::bigint, 'enable and disable each leave an audit record');
select throws_ok($$delete from private.moderation_testing_setting_changes$$, 'P0001', 'MODERATION_RECORD_IMMUTABLE', 'configuration audit is immutable');
select * from finish();
rollback;
