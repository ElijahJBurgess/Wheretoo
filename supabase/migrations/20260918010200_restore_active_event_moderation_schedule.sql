-- UNAPPLIED proposal. Restore the schedule condition inherited from 010575.
-- This preserves the reviewed missing-disclosure enqueue predicate and every
-- other byte of the currently installed function definition.
do $restore_active_schedule$
declare
  v_definition text;
  v_rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'private.invalidate_event_public_revision(uuid,text,uuid)'::regprocedure
  ) into v_definition;

  if pg_catalog.encode(extensions.digest(v_definition, 'sha256'), 'hex')
    <> 'b32f90c4bd9a3de4f28acf6f1af5ed78c36027a923fd58a7f6f1fe7506de9b1d' then
    raise exception using errcode = 'P0001',
      message = 'ACTIVE_MODERATION_SCHEDULE_SOURCE_MISMATCH';
  end if;

  v_rewritten := pg_catalog.replace(
    v_definition,
    'and events.starts_at > v_now',
    'and events.ends_at > v_now'
  );
  if pg_catalog.encode(extensions.digest(v_rewritten, 'sha256'), 'hex')
    <> 'e20ff4f33f4e1b008432ee6b855ce0e2380106f28e1559258d1ac1bc5481bc66' then
    raise exception using errcode = 'P0001',
      message = 'ACTIVE_MODERATION_SCHEDULE_RESULT_MISMATCH';
  end if;

  execute v_rewritten;
end;
$restore_active_schedule$;
