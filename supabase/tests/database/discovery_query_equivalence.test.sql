\set ON_ERROR_STOP on
begin;
set local statement_timeout='180s';
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir discovery_query_baseline.inc
insert into auth.users(id,email) select ('3a000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'db-audit-'||i||'@example.invalid' from generate_series(1,4)i;
insert into public.organizers(id,display_name) select id,'Audit owner '||right(id::text,1) from auth.users where id::text like '3a000000-%';
insert into public.organizer_stripe_accounts(organizer_id,stripe_account_id,transfers_status,payouts_status,requirements_status,requirements_currently_due_count,requirements_past_due_count,last_synced_at)
select id,'acct_task25fixture'||right(id::text,1),'active','active','clear',0,0,now() from public.organizers where id::text like '3a000000-%';
insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,timezone,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type,capacity)
select ('3a100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('3a000000-0000-4000-8000-'||lpad((1+(i-1)%3)::text,12,'0'))::uuid,'Audit Gathering '||i,'A friendly public community gathering for isolated local measurement.',(array['community','music','fitness','art_culture','food_drink','shopping','nightlife','other'])[1+(i-1)%8],now()+interval '1 day',now()+interval '1 day 2 hours','America/Los_Angeles','Audit Venue','1 Broadway','Oakland','CA','94612','US','audit-db-'||i,37.80+(i%5)*0.0001,-122.27+(i%5)*0.0001,case when i%2=0 then 'paid' else 'free' end,100 from generate_series(1,24)i;
insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
select id,'all_ages',false,false,false,false,false,false from public.events where id::text like '3a100000-%';
insert into public.ticket_tiers(event_id,name,unit_amount_minor,currency,quantity_total,status,sort_order)
select id,'Audit admission',1200,'usd',10,'active',1 from public.events where id::text like '3a100000-%' and admission_type='paid';
set local role authenticated;
do $$ declare i int;eid uuid;begin for i in 1..24 loop
 eid:=('3a100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
 perform set_config('request.jwt.claim.sub',('3a000000-0000-4000-8000-'||lpad((1+(i-1)%3)::text,12,'0')),true);
 perform public.accept_current_event_policies(eid);perform public.publish_event(eid);
end loop;end $$;
reset role;
set constraints all immediate;
alter table public.events disable trigger user;
alter table public.ticket_tiers disable trigger user;
alter table private.event_risk_disclosures disable trigger user;
alter table private.event_moderation_actions disable trigger user;
alter table private.event_policy_acceptances disable trigger user;
alter table private.event_policy_legacy_exemptions disable trigger user;
alter table private.event_public_eligibility_intervals disable trigger user;
alter table private.organizer_policy_requirements disable trigger user;
alter table private.organizer_policy_versions disable trigger user;
alter table private.organizer_policy_release_settings disable trigger user;
-- Shared rollback-only fixture for the icon integration tests.
insert into auth.users(id,email) values
 ('29000000-0000-4000-8000-000000000001','icon-owner@example.invalid'),
 ('29000000-0000-4000-8000-000000000002','icon-other@example.invalid');
insert into public.organizers(id,display_name) values
 ('29000000-0000-4000-8000-000000000001','Icon Owner'),
 ('29000000-0000-4000-8000-000000000002','Other Owner');
create temporary table save_input(p jsonb);
insert into save_input values ('{"title":"Draft title","description":null,"category":null,"starts_at":null,"ends_at":null,"timezone":"America/Los_Angeles","venue_name":null,"address_line1":null,"address_line2":null,"city":null,"region":null,"postal_code":null,"country_code":"US","mapbox_feature_id":null,"latitude":null,"longitude":null,"admission_type":"free","capacity":null,"map_icon_version_id":null}');
grant select on save_input to authenticated,anon;
insert into private.map_icons(id,slug,display_name) values
 ('29000000-0000-4000-8000-000000000020','save-test-icon','Test Icon');
insert into private.map_icon_versions(id,icon_id,version,request_id,state,metadata,provenance,package_hash,png_sha256,byte_size,original_path,crop_path,runtime_path,created_by,approved_by,approved_at,published_at)
select ('29000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '29000000-0000-4000-8000-000000000020',n,gen_random_uuid(),state,
 '{"schemaVersion":1,"widthPx":600,"heightPx":922,"pixelRatio":3,"contactPx":[87,922],"anchor":"bottom","selectedScale":1,"desktop":{"minZoom":14.5,"maxZoom":24,"stops":[[14.6,0.18],[14.8,0.19],[16.25,0.22]]},"mobile":{"minZoom":14.5,"maxZoom":24,"stops":[[14.6,0.18],[14.8,0.19],[16.25,0.22]]},"hit":{"kind":"legacy-css-circle","radius":38,"translation":[17,-34],"minTargetDiameter":44},"alignment":{"pitch":"viewport","rotation":"viewport"},"collisionMode":"always-visible","sdf":false}'::jsonb,
 '{}',repeat('a',64),repeat('b',64),500,
 'icons/29000000-0000-4000-8000-000000000020/29000000-0000-4000-8000-'||lpad(n::text,12,'0')||'/original.png',
 'icons/29000000-0000-4000-8000-000000000020/29000000-0000-4000-8000-'||lpad(n::text,12,'0')||'/crop.png',
 'icons/29000000-0000-4000-8000-000000000020/29000000-0000-4000-8000-'||lpad(n::text,12,'0')||'/'||repeat('b',64)||'.png',
 '29000000-0000-4000-8000-000000000001',
 case when state='validated' then null else '29000000-0000-4000-8000-000000000001'::uuid end,
 case when state='validated' then null else now() end,
 case when state in ('validated','approved') then null else now() end
from (values(31,'published'),(32,'validated'),(33,'approved'),(34,'retired'),(35,'revoked')) s(n,state);
update private.map_icons set current_version_id='29000000-0000-4000-8000-000000000031' where id='29000000-0000-4000-8000-000000000020';
update private.map_icon_settings set selection_enabled=true;


create function pg_temp.check_case(label text, expected boolean default null, expected_map boolean default null) returns jsonb language plpgsql as $$
declare target uuid:='3a100000-0000-4000-8000-000000000001';
 old_value boolean;new_value boolean;oid uuid;asof timestamptz;old_rows jsonb;new_rows jsonb;req jsonb;old_page jsonb;new_page jsonb;direct_page jsonb;cursor_value text;pages int;checks int:=0;
begin
 foreach oid in array array[target,'3a100000-0000-4000-8000-000000000002'::uuid,'3a100000-0000-4000-8000-000000000003'::uuid,'3affffff-0000-4000-8000-000000000099'::uuid,null::uuid] loop
  if pg_temp.baseline_current(oid) is distinct from private.event_has_current_public_eligibility(oid) then raise exception 'current predicate mismatch: % %',label,oid;end if;checks:=checks+1;
  foreach asof in array array[null::timestamptz,now()-interval '1 day',statement_timestamp(),now()+interval '9 days'] loop
   if pg_temp.baseline_eligible(oid,asof) is distinct from private.event_is_publicly_eligible(oid,asof) then raise exception 'final predicate mismatch: % % %',label,oid,asof;end if;checks:=checks+1;
  end loop;
 end loop;
 old_value:=pg_temp.baseline_eligible(target,statement_timestamp());
 if expected is not null and old_value is distinct from expected then raise exception 'expected baseline eligibility %, got % in %',expected,old_value,label;end if;
 for req in select * from jsonb_array_elements('[{"west":-122.4,"east":-122.1,"south":37.7,"north":37.9},{"west":-123.6,"east":-121,"south":36.8,"north":38.9},{"west":-122.4,"east":-122.1,"south":37.7,"north":37.9,"category":["music"]},{"west":-122.4,"east":-122.1,"south":37.7,"north":37.9,"category":["community","fitness"]},{"west":-122.6,"east":-122.5,"south":37.7,"north":37.9}]'::jsonb) loop
  select jsonb_agg(to_jsonb(m)) into old_rows from pg_temp.baseline_map((req->>'west')::float8,(req->>'south')::float8,(req->>'east')::float8,(req->>'north')::float8,now(),now()+interval '7 days',case when req ? 'category' then array(select jsonb_array_elements_text(req->'category')) else null end) with ordinality m;
  select jsonb_agg(to_jsonb(m)) into new_rows from public.get_public_map_events((req->>'west')::float8,(req->>'south')::float8,(req->>'east')::float8,(req->>'north')::float8,now(),now()+interval '7 days',case when req ? 'category' then array(select jsonb_array_elements_text(req->'category')) else null end) with ordinality m;
  if old_rows is distinct from new_rows then raise exception 'ordered all-field map mismatch: % %',label,req;end if;checks:=checks+1;
 end loop;
 if expected_map is not null and exists(select 1 from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) m where m.event_id=target) is distinct from expected_map then raise exception 'expected target map membership mismatch in %',label;end if;
 for req in select * from jsonb_array_elements('[{"when":"upcoming","limit":7},{"when":"today","limit":7},{"when":"weekend","limit":7},{"when":"upcoming","category":"music","admissionType":"paid","limit":7},{"when":"upcoming","admissionType":"free","limit":7}]'::jsonb) loop
  req:='{"region":"sf_bay_area"}'::jsonb||req;pages:=0;
  loop
   old_page:=pg_temp.baseline_discovery(req);new_page:=public.server_get_public_discovery_events(req);direct_page:=public.server_get_public_discovery_events(req);
   if old_page is distinct from new_page or old_page is distinct from direct_page then raise exception 'exact list/cursor mismatch: % %',label,req;end if;checks:=checks+2;
   cursor_value:=old_page->>'nextCursor';pages:=pages+1;
   exit when cursor_value is null;
   if pages>10 then raise exception 'unbounded test cursor';end if;
   req:=req||jsonb_build_object('cursor',cursor_value);
  end loop;
 end loop;
 return jsonb_build_object('case',label,'checks',checks,'eligible',old_value,'passed',true);
end $$;

savepoint case_state;

select pg_temp.check_case('baseline',true,true);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set status='draft' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('draft',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set status='cancelled' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('cancelled',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set moderation_status='blocked' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('blocked',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set moderation_status='removed' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('removed',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set moderation_status='under_review' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('under_review',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set moderation_status='not_evaluated' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('not_evaluated',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set published_at=null where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('unpublished',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set content_revision=content_revision+1 where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('stale_content',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set moderated_revision=null where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('stale_moderation',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set content_revision=content_revision+1,moderated_revision=content_revision+1 where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('stale_authorized_revision',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set publicly_authorized_action_id=null,publicly_authorized_revision=null where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('missing_authorized_action',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set public_history_status='unknown',first_publicly_eligible_at=null where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('unknown_history',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set public_history_status='never_public',first_publicly_eligible_at=null where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('never_public',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set title=null where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('null_title',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set title='ab' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('short_title',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set description='short' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('short_description',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set category=null where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('null_category',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set starts_at=null where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('null_start',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set ends_at=null where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('null_end',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set address_line1='  ' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('blank_address',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set city='  ' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('blank_city',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set region='NY' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('wrong_region',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set postal_code=' ' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('blank_postal',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set country_code='CA' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('wrong_country',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set mapbox_feature_id=' ' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('blank_mapbox',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set latitude=null,longitude=null,location=null where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('null_coords',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set location=null where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('null_location',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set longitude=-120 where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('unsupported_longitude',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set latitude=40 where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('unsupported_latitude',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set artwork_path='private/old-artwork.jpg' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('legacy_artwork',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set public_eligibility_version=public_eligibility_version+1 where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('wrong_interval_epoch',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set organizer_id='3a000000-0000-4000-8000-000000000002' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('changed_organizer',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('ended',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 second' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('ends_at_now',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set starts_at=now()-interval '2 hours',ends_at=now()+interval '1 hour' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('ongoing',true,true);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set starts_at=now()+interval '8 days',ends_at=now()+interval '9 days' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('outside_window',true,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set starts_at=now()+interval '7 days',ends_at=now()+interval '7 days 1 hour' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('exclusive_window_end',true,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set longitude=-122.5,location=extensions.st_setsrid(extensions.st_makepoint(-122.5,37.8),4326)::extensions.geography where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('outside_viewport',true,false);
rollback to case_state;release case_state;

savepoint case_state;
delete from private.event_risk_disclosures where event_id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('no_disclosure',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_risk_disclosures set cannabis_present=true where event_id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('cannabis_age_mismatch',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_risk_disclosures set explicit_adult_content=true where event_id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('mature_age_mismatch',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_risk_disclosures set cannabis_present=true,minimum_age='21_plus' where event_id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('valid_cannabis_21plus',true,true);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_moderation_actions set event_id='3a100000-0000-4000-8000-000000000003' where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001');
select pg_temp.check_case('wrong_action_event',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_moderation_actions set content_revision=content_revision+1 where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001');
select pg_temp.check_case('wrong_action_revision',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_moderation_actions set input_sha256=repeat('f',64) where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001');
select pg_temp.check_case('wrong_action_digest',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_moderation_actions set actor_user_id='3a000000-0000-4000-8000-000000000004' where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001');
select pg_temp.check_case('wrong_actor',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_moderation_actions set policy_acceptance_id=(select policy_acceptance_id from private.event_moderation_actions where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000003')) where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001');
select pg_temp.check_case('wrong_acceptance',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_policy_acceptances set event_id='3a100000-0000-4000-8000-000000000003' where id=(select policy_acceptance_id from private.event_moderation_actions where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001'));
select pg_temp.check_case('acceptance_wrong_event',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_policy_acceptances set organizer_id='3a000000-0000-4000-8000-000000000004' where id=(select policy_acceptance_id from private.event_moderation_actions where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001'));
select pg_temp.check_case('acceptance_wrong_organizer',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_policy_acceptances set accepted_by_user_id='3a000000-0000-4000-8000-000000000004' where id=(select policy_acceptance_id from private.event_moderation_actions where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001'));
select pg_temp.check_case('acceptance_wrong_user',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_policy_acceptances set content_revision=content_revision+1 where id=(select policy_acceptance_id from private.event_moderation_actions where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001'));
select pg_temp.check_case('acceptance_wrong_revision',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_policy_acceptances set input_sha256=repeat('e',64) where id=(select policy_acceptance_id from private.event_moderation_actions where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001'));
select pg_temp.check_case('acceptance_wrong_digest',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_policy_acceptances set organizer_terms_version_id='dev-event-policy-v1' where id=(select policy_acceptance_id from private.event_moderation_actions where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001'));
select pg_temp.check_case('terms_wrong_kind',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_policy_acceptances set event_policy_version_id='dev-organizer-terms-v1' where id=(select policy_acceptance_id from private.event_moderation_actions where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001'));
select pg_temp.check_case('policy_wrong_kind',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_public_eligibility_intervals set ended_at=statement_timestamp(),ended_action_id=started_action_id where event_id='3a100000-0000-4000-8000-000000000001' and ended_at is null;
select pg_temp.check_case('interval_ended',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.event_public_eligibility_intervals set eligibility_state='ineligible' where event_id='3a100000-0000-4000-8000-000000000001' and ended_at is null;
select pg_temp.check_case('interval_ineligible',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.organizer_policy_release_settings set environment='unconfigured';
select pg_temp.check_case('policy_unconfigured',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update private.organizer_policy_release_settings set environment='production';
select pg_temp.check_case('production_with_dev_policies',false,false);
rollback to case_state;release case_state;

savepoint case_state;
delete from private.organizer_policy_requirements where policy_kind='event_policy';
select pg_temp.check_case('missing_policy_requirement',false,false);
rollback to case_state;release case_state;

savepoint case_state;
delete from private.organizer_policy_release_settings;
select pg_temp.check_case('missing_release_settings',false,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.ticket_tiers set status='archived' where event_id='3a100000-0000-4000-8000-000000000002';
select pg_temp.check_case('paid_tier_inactive',true,true);
rollback to case_state;release case_state;

savepoint case_state;
update public.ticket_tiers set quantity_total=1 where event_id='3a100000-0000-4000-8000-000000000002';
select pg_temp.check_case('paid_tier_sold_out',true,true);
rollback to case_state;release case_state;

savepoint case_state;
insert into private.event_policy_legacy_exemptions(id,event_id,grandfathered_content_revision,input_sha256,migration_identifier)
select '3a200000-0000-4000-8000-000000000001',event_id,content_revision,input_sha256,'audit-only' from private.event_moderation_actions where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001');
update private.event_moderation_actions set policy_acceptance_id=null,policy_legacy_exemption_id='3a200000-0000-4000-8000-000000000001',source='migration',actor_type='system',actor_user_id=null where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001');
select pg_temp.check_case('legacy_valid',true,true);
rollback to case_state;release case_state;

savepoint case_state;
insert into private.event_policy_legacy_exemptions(id,event_id,grandfathered_content_revision,input_sha256,migration_identifier)
select '3a200000-0000-4000-8000-000000000001',event_id,content_revision,input_sha256,'audit-only' from private.event_moderation_actions where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001');
update private.event_moderation_actions set policy_acceptance_id=null,policy_legacy_exemption_id='3a200000-0000-4000-8000-000000000001',source='migration',actor_type='system',actor_user_id=null where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001');update private.event_policy_legacy_exemptions set input_sha256=repeat('d',64) where id='3a200000-0000-4000-8000-000000000001';
select pg_temp.check_case('legacy_wrong_digest',false,false);
rollback to case_state;release case_state;

savepoint case_state;
insert into private.event_policy_legacy_exemptions(id,event_id,grandfathered_content_revision,input_sha256,migration_identifier)
select '3a200000-0000-4000-8000-000000000001',event_id,content_revision,input_sha256,'audit-only' from private.event_moderation_actions where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001');
update private.event_moderation_actions set policy_acceptance_id=null,policy_legacy_exemption_id='3a200000-0000-4000-8000-000000000001',source='migration',actor_type='system',actor_user_id=null where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001');update private.event_policy_legacy_exemptions set grandfathered_content_revision=grandfathered_content_revision+1 where id='3a200000-0000-4000-8000-000000000001';
select pg_temp.check_case('legacy_wrong_revision',false,false);
rollback to case_state;release case_state;

savepoint case_state;
insert into private.event_policy_legacy_exemptions(id,event_id,grandfathered_content_revision,input_sha256,migration_identifier)
select '3a200000-0000-4000-8000-000000000001',event_id,content_revision,input_sha256,'audit-only' from private.event_moderation_actions where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001');
update private.event_moderation_actions set policy_acceptance_id=null,policy_legacy_exemption_id='3a200000-0000-4000-8000-000000000001',source='migration',actor_type='system',actor_user_id=null where id=(select publicly_authorized_action_id from public.events where id='3a100000-0000-4000-8000-000000000001');update private.event_policy_legacy_exemptions set event_id='3a100000-0000-4000-8000-000000000003' where id='3a200000-0000-4000-8000-000000000001';
select pg_temp.check_case('legacy_wrong_event',false,false);
rollback to case_state;release case_state;

savepoint case_state;
insert into private.organizer_policy_versions(id,policy_kind,stage,public_url,content_sha256,effective_at) values('audit-prod-terms','organizer_terms','production_approved','https://policies.example.invalid/terms',repeat('a',64),now()),('audit-prod-event','event_policy','production_approved','https://policies.example.invalid/events',repeat('b',64),now());
update private.organizer_policy_requirements set policy_version_id=case policy_kind when 'organizer_terms' then 'audit-prod-terms' else 'audit-prod-event' end;
update private.organizer_policy_release_settings set environment='production';

select pg_temp.check_case('production_approved_pair_keeps_historical_acceptance',true,true);
rollback to case_state;release case_state;

savepoint case_state;
delete from public.organizer_stripe_accounts;
select pg_temp.check_case('stripe_account_removed_after_authorization',true,true);
rollback to case_state;release case_state;

savepoint case_state;
update private.map_icon_settings set rendering_enabled=true;update public.events set map_icon_version_id='29000000-0000-4000-8000-000000000031' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('icon_published',true,true);
rollback to case_state;release case_state;

savepoint case_state;
update private.map_icon_settings set rendering_enabled=true;update public.events set map_icon_version_id='29000000-0000-4000-8000-000000000034' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('icon_retired',true,true);
rollback to case_state;release case_state;

savepoint case_state;
update private.map_icon_settings set rendering_enabled=true;update public.events set map_icon_version_id='29000000-0000-4000-8000-000000000032' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('icon_validated',true,true);
rollback to case_state;release case_state;

savepoint case_state;
update private.map_icon_settings set rendering_enabled=true;update public.events set map_icon_version_id='29000000-0000-4000-8000-000000000033' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('icon_approved',true,true);
rollback to case_state;release case_state;

savepoint case_state;
update private.map_icon_settings set rendering_enabled=true;update public.events set map_icon_version_id='29000000-0000-4000-8000-000000000035' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('icon_revoked',true,true);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set map_icon_version_id='29000000-0000-4000-8000-000000000031' where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('icon_rendering_disabled',true,true);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set longitude=-123.6,latitude=36.8,location=extensions.st_setsrid(extensions.st_makepoint(-123.6,36.8),4326)::extensions.geography where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('boundary_southwest',true,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.events set longitude=-121,latitude=38.9,location=extensions.st_setsrid(extensions.st_makepoint(-121,38.9),4326)::extensions.geography where id='3a100000-0000-4000-8000-000000000001';
select pg_temp.check_case('boundary_northeast',true,false);
rollback to case_state;release case_state;

savepoint case_state;
update public.organizers set onboarding_completed_at=null where id::text like '3a000000-%';
select pg_temp.check_case('organizer_onboarding_incomplete',true,true);
rollback to case_state;release case_state;

create function pg_temp.assert_denied(q text) returns text language plpgsql as $$ begin execute q;raise exception 'unexpected privilege';exception when insufficient_privilege then return 'denied';end $$;
set local role anon;
select is(pg_temp.assert_denied('select * from public.events'),'denied'::text,'private/direct reads remain denied');
select is(pg_temp.assert_denied('select * from public.organizers'),'denied'::text,'private/direct reads remain denied');
select is(pg_temp.assert_denied('select * from private.current_publicly_eligible_event_ids()'),'denied'::text,'private/direct reads remain denied');
select is(pg_temp.assert_denied('select private.event_has_current_public_eligibility(null)'),'denied'::text,'private/direct reads remain denied');
select is(pg_temp.assert_denied('select public.server_get_public_discovery_events(''{}'')'),'denied'::text,'private/direct reads remain denied');
select ok(((select jsonb_agg(to_jsonb(m)) from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) with ordinality m) is not distinct from (select jsonb_agg(to_jsonb(m)) from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) with ordinality m)),'public results or rejection remains identical');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','3a000000-0000-4000-8000-000000000004',true);
select is(pg_temp.assert_denied('select * from private.current_publicly_eligible_event_ids()'),'denied'::text,'private/direct reads remain denied');
select is(pg_temp.assert_denied('select public.server_get_public_discovery_events(''{}'')'),'denied'::text,'private/direct reads remain denied');
select ok(((select jsonb_agg(to_jsonb(m)) from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) with ordinality m) is not distinct from (select jsonb_agg(to_jsonb(m)) from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',null) with ordinality m)),'public results or rejection remains identical');
reset role;
set local role service_role;
select is(pg_temp.assert_denied('select * from private.current_publicly_eligible_event_ids()'),'denied'::text,'private/direct reads remain denied');
select ok((pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming"}') = public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}')),'public results or rejection remains identical');
reset role;

create function pg_temp.error_result(q text) returns text language plpgsql as $$ begin execute q;return 'ok';exception when others then return sqlstate||':'||sqlerrm;end $$;
select ok((pg_temp.error_result($q$select * from pg_temp.baseline_map(null,37.7,-122.1,37.9,now(),now()+interval '7 days',null)$q$) = pg_temp.error_result($q$select * from public.get_public_map_events(null,37.7,-122.1,37.9,now(),now()+interval '7 days',null)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select * from pg_temp.baseline_map(-122.1,37.7,-122.4,37.9,now(),now()+interval '7 days',null)$q$) = pg_temp.error_result($q$select * from public.get_public_map_events(-122.1,37.7,-122.4,37.9,now(),now()+interval '7 days',null)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select * from pg_temp.baseline_map(-122.4,37.9,-122.1,37.7,now(),now()+interval '7 days',null)$q$) = pg_temp.error_result($q$select * from public.get_public_map_events(-122.4,37.9,-122.1,37.7,now(),now()+interval '7 days',null)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select * from pg_temp.baseline_map(-122.4,37.7,-122.1,91,now(),now()+interval '7 days',null)$q$) = pg_temp.error_result($q$select * from public.get_public_map_events(-122.4,37.7,-122.1,91,now(),now()+interval '7 days',null)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '8 days',null)$q$) = pg_temp.error_result($q$select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '8 days',null)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now()+interval '1 day',now(),null)$q$) = pg_temp.error_result($q$select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now()+interval '1 day',now(),null)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',array[]::text[])$q$) = pg_temp.error_result($q$select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',array[]::text[])$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',array['invalid']::text[])$q$) = pg_temp.error_result($q$select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',array['invalid']::text[])$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select * from pg_temp.baseline_map(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',array[null]::text[])$q$) = pg_temp.error_result($q$select * from public.get_public_map_events(-122.4,37.7,-122.1,37.9,now(),now()+interval '7 days',array[null]::text[])$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select pg_temp.baseline_discovery('{}'::jsonb)$q$) = pg_temp.error_result($q$select public.server_get_public_discovery_events('{}'::jsonb)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select pg_temp.baseline_discovery('null'::jsonb)$q$) = pg_temp.error_result($q$select public.server_get_public_discovery_events('null'::jsonb)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select pg_temp.baseline_discovery('[]'::jsonb)$q$) = pg_temp.error_result($q$select public.server_get_public_discovery_events('[]'::jsonb)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select pg_temp.baseline_discovery('{"region":"elsewhere","when":"upcoming"}'::jsonb)$q$) = pg_temp.error_result($q$select public.server_get_public_discovery_events('{"region":"elsewhere","when":"upcoming"}'::jsonb)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"unknown"}'::jsonb)$q$) = pg_temp.error_result($q$select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"unknown"}'::jsonb)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming","category":null}'::jsonb)$q$) = pg_temp.error_result($q$select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming","category":null}'::jsonb)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming","price":"free"}'::jsonb)$q$) = pg_temp.error_result($q$select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming","price":"free"}'::jsonb)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming","limit":51}'::jsonb)$q$) = pg_temp.error_result($q$select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming","limit":51}'::jsonb)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming","limit":0}'::jsonb)$q$) = pg_temp.error_result($q$select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming","limit":0}'::jsonb)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming","limit":1.5}'::jsonb)$q$) = pg_temp.error_result($q$select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming","limit":1.5}'::jsonb)$q$)),'public results or rejection remains identical');
select ok((pg_temp.error_result($q$select pg_temp.baseline_discovery('{"region":"sf_bay_area","when":"upcoming","cursor":"bad!"}'::jsonb)$q$) = pg_temp.error_result($q$select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming","cursor":"bad!"}'::jsonb)$q$)),'public results or rejection remains identical');
select ok(true,'78 adversarial eligibility cases and exact payload/cursor comparisons passed');
select * from finish();
rollback;
