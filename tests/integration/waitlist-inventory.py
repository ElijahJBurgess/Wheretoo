#!/usr/bin/env python3
"""Rollback-only inventory equivalence against isolated local Waitlist DB."""
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[2]
DB='supabase_db_wheretoo-waitlist'
def expand(path):
    return '\n'.join(expand(path.parent/line[4:]) if line.startswith('\\ir ') else line for line in path.read_text().splitlines())
def sql(text):
    p=subprocess.run(['docker','exec','-i',DB,'psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],input=text,text=True,capture_output=True)
    if p.returncode: raise RuntimeError(p.stderr)
    return p.stdout
if __name__=='__main__':
    source=subprocess.check_output(['git','show','dd33333c4f9f17079559be62ffa1ad2762b4061b:supabase/migrations/20260902010100_add_checkout_cart_reservation.sql'],cwd=ROOT,text=True)
    original=source[source.index('create or replace function public.get_public_event_ticketing'):source.index('revoke all on function private.calculate_checkout_money')].replace('public.get_public_event_ticketing','pg_temp.original_ticketing')
    result=sql('begin;'+original+expand(ROOT/'tests/integration/waitlist-inventory.sql')+'rollback;')
    print(result)
    assert 'not ok' not in result, 'Inventory equivalence failed'
