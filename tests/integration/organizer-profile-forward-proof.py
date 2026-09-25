"""Forward-only preservation proof on the allowlisted feature proof2 baseline DB."""
import importlib.util, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('local',ROOT/'tests/integration/organizer-profile-proof2.py')
local=importlib.util.module_from_spec(spec);spec.loader.exec_module(local)

def snapshot():
 return json.loads(local.sql('feature',"""select jsonb_build_object(
 'organizers',(select jsonb_agg(to_jsonb(o) order by id) from public.organizers o),
 'media',(select jsonb_agg(to_jsonb(m) order by id) from private.organizer_media m),
 'objects',(select jsonb_agg(to_jsonb(o) order by id) from storage.objects o),
 'buckets',(select jsonb_agg(to_jsonb(b) order by id) from storage.buckets b));"""))

if __name__=='__main__':
 assert local.sql('feature',"select to_regprocedure('public.save_owned_organizer_setup(jsonb,timestamptz,uuid)') is null;").strip()=='t','Expected pristine baseline before forward application'
 local.sql('feature',"""
 insert into auth.users(id,email) select ('26000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'forward-'||n||'@example.invalid' from generate_series(1,8) n;
 insert into public.organizers(id,display_name,organizer_type,bio,website_url,base_city,onboarding_completed_at)
 select id,'Forward '||right(id::text,1),case when right(id::text,1) in ('2','3','7','8') then 'Venue' end,
 case when right(id::text,1) in ('2','3','8') then 'Existing biography' end,
 case when right(id::text,1) in ('3','8') then 'https://example.invalid' end,
 case when right(id::text,1) in ('2','3','7','8') then 'Oakland' end,
 case when right(id::text,1) in ('3','4','7','8') then '2026-09-01T00:00:00Z'::timestamptz end from auth.users where email like 'forward-%@example.invalid';
 insert into storage.objects(id,bucket_id,name,metadata,user_metadata)
 select ('26000000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,'organizer-media',
 '26000000-0000-4000-8000-'||lpad(n::text,12,'0')||'/26000000-0000-4000-9000-'||lpad(n::text,12,'0')||'.png',
 '{"size":100,"mimetype":"image/png"}'::jsonb,jsonb_build_object('organizer_id','26000000-0000-4000-8000-'||lpad(n::text,12,'0')) from unnest(array[4,5,8]) n;
 update public.organizers set storefront_logo_asset_id=('26000000-0000-4000-9000-'||right(id::text,12))::uuid where right(id::text,1) in ('4','5','8');
 update public.organizers set handle='forward-'||right(id::text,1),handle_confirmed_at='2026-09-01T00:00:00Z' where right(id::text,1) in ('4','6','8');
 update public.organizers set storefront_accent='violet',storefront_links='{"instagram":"https://instagram.com/forward"}',storefront_store_url='https://example.invalid/store',storefront_merch='[{"title":"Existing item","url":"https://example.invalid/item","imageId":"26000000-0000-4000-9000-000000000008"}]',storefront_cover_asset_id=storefront_logo_asset_id where right(id::text,1)='8';
 """)
 before=snapshot();assert len(before['organizers'])==8
 local.sql('feature','begin;'+(ROOT/'supabase/migrations'/local.MIGRATION).read_text()+'commit;')
 after=snapshot();assert before==after,'Forward migration changed persisted data'
 assert local.sql('feature',"select to_regprocedure('public.save_owned_organizer_setup(jsonb,timestamptz,uuid)') is not null;").strip()=='t'
 print(json.dumps({'result':'PASS','fixtures':8,'preserved':['all organizer columns and timestamps','completion','claimed handles','identity counts','media ownership','storefront branding/links/merch','storage objects and buckets'],'migration':local.MIGRATION},indent=2))
