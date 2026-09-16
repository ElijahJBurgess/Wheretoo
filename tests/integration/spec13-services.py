#!/usr/bin/env python3
"""Only the identity-recorded Spec 13 loopback PostgREST facade."""
import importlib.util, json, pathlib, subprocess, sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('spec13db',ROOT/'tests/integration/spec13-database.py')
db=importlib.util.module_from_spec(spec);spec.loader.exec_module(db)
NAME='whereto-spec13-rest'
IDENTITY=ROOT/'.superpowers/spec13/rest-identity.json'

def verify():
    db.verify()
    known=json.loads(IDENTITY.read_text())
    live=json.loads(subprocess.check_output(['docker','inspect',NAME],text=True))[0]
    assert live['Id']==known['id'] and live['Name']=='/'+NAME
    assert live['Config']['Labels'].get('wheretoo.task')=='spec13-discovery-home'
    assert live['NetworkSettings']['Ports']['3000/tcp']==[{'HostIp':'127.0.0.1','HostPort':'55566'}]
    return live['Id']

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='create':
        assert not IDENTITY.exists(), 'REST identity exists; refusing replacement'
        assert subprocess.run(['docker','inspect',NAME],capture_output=True).returncode!=0
        db.sql("alter role authenticator with login password 'spec13-disposable-only';")
        result=subprocess.check_output(['docker','run','--pull','never','--name',NAME,'--label','wheretoo.task=spec13-discovery-home','-p','127.0.0.1:55566:3000',
          '-e','PGRST_DB_URI=postgres://authenticator:spec13-disposable-only@host.docker.internal:55565/postgres',
          '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon',
          '-e','PGRST_JWT_SECRET=spec13-local-only-jwt-secret-disposable-2026',
          '-e','PGRST_DB_EXTRA_SEARCH_PATH=public,extensions','-d','public.ecr.aws/supabase/postgrest:v14.15'],text=True).strip()
        IDENTITY.write_text(json.dumps({'id':result,'name':NAME})+'\n')
    print('Verified Spec 13 local REST:',verify())
