insert into auth.users(id,email) values('b6100000-0000-4000-8000-000000000001','free-owner@example.invalid'),('b6100000-0000-4000-8000-000000000002','free-other@example.invalid');
insert into public.organizers(id,display_name) values('b6100000-0000-4000-8000-000000000001','Free Owner'),('b6100000-0000-4000-8000-000000000002','Other Owner');
insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type,capacity)
select ('b6200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b6100000-0000-4000-8000-000000000001',
 'Free RSVP Event '||n,'A low risk community gathering for registration tests.','community',now()+interval '1 day',now()+interval '1 day 2 hours','Civic Hall','1 Market Street','San Francisco','CA','94105','US','mapbox.free-fixture-'||n,37.7936,-122.3958,'free',case when n=1 then 3 when n=3 then 1 else null end
from generate_series(1,3) n;
insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
select id,'all_ages',false,false,false,false,false,false from public.events where organizer_id='b6100000-0000-4000-8000-000000000001';
update private.organizer_policy_requirements set policy_version_id=case policy_kind when 'organizer_terms' then 'dev-organizer-terms-v1' else 'dev-event-policy-v1' end;
update private.organizer_policy_release_settings set environment='development',updated_at=statement_timestamp() where singleton_id;
select set_config('request.jwt.claim.sub','b6100000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.accept_current_event_policies(id) from public.events where organizer_id='b6100000-0000-4000-8000-000000000001';
select public.publish_event(id) from public.events where organizer_id='b6100000-0000-4000-8000-000000000001';
reset role;
create function pg_temp.free_manifest(p_quantity integer,p_seed text) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('unit_sequence',n,'credential_hash',encode(extensions.digest(p_seed||':'||n,'sha256'),'hex')) order by n) from generate_series(1,p_quantity) n;
$$;
create function pg_temp.register(p_number integer,p_qty integer default 2,p_event integer default 1,p_name text default 'Pat Guest',p_email text default 'pat@example.invalid',p_proof text default null) returns jsonb language sql as $$
 select public.server_confirm_free_registration(('b6300000-0000-4000-8000-'||lpad(p_number::text,12,'0'))::uuid,
 ('b6200000-0000-4000-8000-'||lpad(p_event::text,12,'0'))::uuid,p_name,p_email,p_qty,
 coalesce(p_proof,encode(extensions.digest('proof:'||p_number,'sha256'),'hex')),pg_temp.free_manifest(p_qty,p_number::text));
$$;
