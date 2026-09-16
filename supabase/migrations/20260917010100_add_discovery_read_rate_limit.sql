-- Discovery reads cannot spend checkout, email, report or RSVP quotas.
create table private.discovery_read_rate_buckets (
  identity_hash text not null check(identity_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  attempts integer not null check(attempts between 1 and 61),
  primary key(identity_hash,window_start)
);
create index discovery_read_rate_expiry_idx on private.discovery_read_rate_buckets(window_start,identity_hash);
revoke all on private.discovery_read_rate_buckets from public,anon,authenticated,service_role;

create function public.server_consume_discovery_read_rate_limit(p_identity_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  now_at timestamptz:=clock_timestamp();
  start_at timestamptz:=date_trunc('minute',now_at);
  attempt integer;
  expired record;
begin
  if p_identity_hash is null or p_identity_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='DISCOVERY_QUERY_INVALID';
  end if;
  -- Provisional 60/minute. Saturation avoids unbounded counters under sustained abuse.
  insert into private.discovery_read_rate_buckets(identity_hash,window_start,attempts) values(p_identity_hash,start_at,1)
  on conflict(identity_hash,window_start) do update set attempts=least(private.discovery_read_rate_buckets.attempts+1,61)
  returning attempts into attempt;
  -- One-hour age threshold, not a retention guarantee while idle or backlogged.
  -- A delete join can scan the whole bucket table despite a bounded CTE.
  -- Each locked tuple instead gets one direct TID lookup, at most 100 times.
  for expired in
    select ctid from private.discovery_read_rate_buckets
    where window_start<start_at-interval '1 hour'
    order by window_start,identity_hash limit 100 for update skip locked
  loop
    delete from private.discovery_read_rate_buckets buckets where buckets.ctid=expired.ctid;
  end loop;
  return jsonb_build_object('allowed',attempt<=60,'retryAfterSeconds',case when attempt<=60 then 0 else greatest(1,ceil(extract(epoch from start_at+interval '1 minute'-now_at))::integer) end);
end;
$$;
revoke all on function public.server_consume_discovery_read_rate_limit(text) from public,anon,authenticated,service_role;
grant execute on function public.server_consume_discovery_read_rate_limit(text) to service_role;
