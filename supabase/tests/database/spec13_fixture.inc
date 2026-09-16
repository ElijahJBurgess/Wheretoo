-- Rollback-only synthetic fixtures; this helper uses the canonical publication pipeline.
insert into auth.users(id,email) values('d1300000-0000-4000-8000-000000000001','spec13-owner@example.invalid');
insert into public.organizers(id,display_name) values('d1300000-0000-4000-8000-000000000001','Discovery fixture owner');
insert into public.events(id,organizer_id,title,description,category,starts_at,ends_at,venue_name,address_line1,city,region,postal_code,country_code,mapbox_feature_id,latitude,longitude,admission_type)
select ('d1310000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d1300000-0000-4000-8000-000000000001','Discovery fixture '||n,
'A calm community gathering for disposable discovery verification.',(array['food_drink','music','fitness','art_culture','shopping','community','nightlife','other'])[1+(n-1)%8],
statement_timestamp()+interval '1 day',statement_timestamp()+interval '1 day 2 hours','Fixture Hall','1 Market Street','San Francisco','CA','94105','US','mapbox.spec13.'||n,37.7936,-122.3958,case when n%2=0 then 'paid' else 'free' end
from generate_series(1,64) n;
insert into public.ticket_tiers(event_id,name,unit_amount_minor,currency,quantity_total,status,sort_order)
select id,'Fixture admission',1200,'usd',10,'active',1 from public.events where organizer_id='d1300000-0000-4000-8000-000000000001' and admission_type='paid';
insert into public.organizer_stripe_accounts(organizer_id,stripe_account_id,transfers_status,payouts_status,requirements_status,requirements_currently_due_count,requirements_past_due_count,last_synced_at)
values('d1300000-0000-4000-8000-000000000001','acct_spec13rollback','active','active','clear',0,0,now());
insert into private.event_risk_disclosures(event_id,minimum_age,alcohol_present,cannabis_present,explicit_adult_content,gambling_present,weapons_present,high_risk_activity)
select id,'all_ages',false,false,false,false,false,false from public.events where organizer_id='d1300000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','d1300000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.accept_current_event_policies(id) from public.events where organizer_id='d1300000-0000-4000-8000-000000000001';
select public.publish_event(id) from public.events where organizer_id='d1300000-0000-4000-8000-000000000001';
reset role;
create function pg_temp.discovery(q jsonb default '{}') returns jsonb language sql as $$select public.server_get_public_discovery_events('{"region":"sf_bay_area","when":"upcoming"}'::jsonb||q)$$;
