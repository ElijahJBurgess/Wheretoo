-- New paid admission must still be eligible after every reservation lock wait.
-- Preserve exact-request recovery, inventory math and settlement history.
do $$
declare
  v_definition text;
  v_target text := '  v_order_id := gen_random_uuid();';
  v_replacement text := $replacement$  -- All admission locks (including Connect/fee share locks and expired-order
  -- updates) have completed. Only a new request reaches this final check;
  -- persisted exact requests returned above retain their historical contract.
  if not private.event_is_publicly_eligible(p_event_id, pg_catalog.clock_timestamp()) then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_SELLABLE';
  end if;

  v_order_id := gen_random_uuid();$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'private.reserve_checkout(uuid,jsonb,text,text,uuid,text)'::regprocedure
  ) into v_definition;

  -- Audited latest-main and staging definitions match this hash. Fail closed
  -- on drift rather than replacing a different reservation implementation.
  if v_definition is null
    or pg_catalog.md5(v_definition) <> '556c9cafcea77ec2ee81c260d84d14a7'
    or pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_target, '')
    ) <> pg_catalog.length(v_target) then
    raise exception using errcode = 'P0001', message = 'PAID_ADMISSION_EXPIRY_MIGRATION_MISMATCH';
  end if;

  execute pg_catalog.replace(v_definition, v_target, v_replacement);
end;
$$;
