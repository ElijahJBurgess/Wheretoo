#!/usr/bin/env python3
"""Measure exact bounded cleanup after M02; rollback all synthetic rate rows."""
import importlib.util,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('db',ROOT/'tests/integration/spec13-database.py');db=importlib.util.module_from_spec(spec);spec.loader.exec_module(db)
print(db.sql("""begin;
insert into private.discovery_read_rate_buckets select lpad(to_hex(n),64,'0'),date_trunc('minute',statement_timestamp())-interval '2 hours',1 from generate_series(1,10000)n;
analyze private.discovery_read_rate_buckets;
explain(analyze,buffers,format json)
select ctid from private.discovery_read_rate_buckets
where window_start<date_trunc('minute',statement_timestamp())-interval '1 hour'
order by window_start,identity_hash limit 100 for update skip locked;
select ctid as cleanup_tid from private.discovery_read_rate_buckets order by window_start,identity_hash limit 1 \gset
explain(analyze,buffers,format json) delete from private.discovery_read_rate_buckets where ctid=:'cleanup_tid'::tid;
explain(analyze,buffers,format json) select public.server_consume_discovery_read_rate_limit(repeat('f',64));
select count(*) as expired_remaining from private.discovery_read_rate_buckets where window_start<statement_timestamp()-interval '1 hour';
rollback;"""))
