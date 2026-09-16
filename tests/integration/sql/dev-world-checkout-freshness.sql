-- Requires the development world. All fixture changes roll back.
begin;
do $$
begin
  if (select environment from private.organizer_policy_release_settings where singleton_id) is distinct from 'development' then
    raise exception 'DEVELOPMENT_ONLY';
  end if;
  update public.organizer_stripe_accounts
  set last_synced_at = statement_timestamp() - interval '10 minutes'
  where organizer_id = '8ad057c1-f7b1-4aec-90cb-260908000001' and not livemode;
  if not found then raise exception 'DEV_WORLD_REQUIRED'; end if;
  perform * from public.server_get_checkout_preflight(
    '8ad057c1-f7b1-4aec-90cb-260908000011',
    array['8ad057c1-f7b1-4aec-90cb-260908000021'::uuid]);
  begin
    perform * from private.reserve_checkout(
      '8ad057c1-f7b1-4aec-90cb-260908000011',
      '[{"tier_id":"8ad057c1-f7b1-4aec-90cb-260908000021","quantity":1}]'::jsonb,
      'Regression Guest', 'regression@example.invalid', gen_random_uuid(), repeat('a',64));
    raise exception 'STALE_RESERVATION_WAS_ALLOWED';
  exception when raise_exception then
    if sqlerrm <> 'CONNECT_NOT_READY' then raise; end if;
  end;
end;
$$;
rollback;
select 'PASS: stale preflight permits refresh; stale reservation is rejected' as result;
