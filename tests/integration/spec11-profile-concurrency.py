"""Real SQL races against the identity-checked Spec 11 disposable DB only."""
import concurrent.futures, importlib.util, pathlib, subprocess, uuid
spec=importlib.util.spec_from_file_location('spec11_db',pathlib.Path(__file__).with_name('spec11-database.py'))
db=importlib.util.module_from_spec(spec);spec.loader.exec_module(db)
owner=str(uuid.uuid4())
db.sql(f"insert into auth.users(id,email) values('{owner}','{owner}@example.invalid'); insert into public.organizers(id,display_name,bio,organizer_type,onboarding_completed_at,updated_at) values('{owner}','Concurrent organizer','Original','Venue','2026-08-01','2026-08-01');")
def save(index):
    identity=db.verify()
    request=f"begin; set local request.jwt.claim.sub='{owner}'; set local role authenticated; select * from public.save_owned_organizer_settings('Concurrent organizer','Writer {index}','2026-08-01'); select pg_sleep(0.1); commit;"
    return subprocess.run(['docker','exec','-i',identity,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],input=request,text=True,capture_output=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results=list(pool.map(save,range(8)))
assert sum(r.returncode==0 for r in results)==1,'Exactly one concurrent save must win'
assert sum('ORGANIZER_SETTINGS_CONFLICT' in r.stderr for r in results)==7,'All stale contenders must receive conflict'
assert 'Venue|2026-08-01' in db.sql(f"copy (select organizer_type,onboarding_completed_at::date from public.organizers where id='{owner}') to stdout with delimiter '|';")
print('PASS: 8 simultaneous Settings saves: 1 committed, 7 explicit conflicts; hidden/onboarding fields preserved.')
