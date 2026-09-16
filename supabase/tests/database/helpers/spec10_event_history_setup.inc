insert into auth.users(id,email) values ('aa100000-0000-4000-8000-000000000001','spec10-history-owner@example.invalid'),('aa100000-0000-4000-8000-000000000002','spec10-history-other@example.invalid');
insert into public.organizers(id,display_name) values ('aa100000-0000-4000-8000-000000000001','History Community'),('aa100000-0000-4000-8000-000000000002','Other Community');
insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,timezone,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type,capacity)
values('aa200000-0000-4000-8000-000000000001','aa100000-0000-4000-8000-000000000001','History gathering','A local neighborhood community gathering.','community',now()+interval '3 days',now()+interval '3 days 2 hours','America/Los_Angeles','Community Hall','1 Main Street','San Francisco','CA','94105','US','mapbox.spec10-history',37.7936,-122.3958,'free',30);
select set_config('request.jwt.claim.sub','aa100000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.save_owned_event_requirements('aa200000-0000-4000-8000-000000000001','{"minimum_age":"all_ages","alcohol_present":false,"cannabis_present":false,"explicit_adult_content":false,"gambling_present":false,"weapons_present":false,"high_risk_activity":false}');
select public.accept_current_event_policies('aa200000-0000-4000-8000-000000000001');
select public.publish_event('aa200000-0000-4000-8000-000000000001');
