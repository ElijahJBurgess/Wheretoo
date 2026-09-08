-- Forward-only correction: the idempotency lookup resets FOUND for all new
-- carts, so event existence must use the already locked event record instead.
do $$
declare
  v_definition text;
  v_target text := 'if not found or v_event.admission_type is distinct from ''paid''';
  v_replacement text := 'if v_event.id is null or v_event.admission_type is distinct from ''paid''';
begin
  select pg_catalog.pg_get_functiondef(
    'private.reserve_checkout(uuid,jsonb,text,text,uuid,text)'::regprocedure
  ) into v_definition;
  if v_definition is null
    or pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_target, '')
    ) <> pg_catalog.length(v_target) then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_CART_EVENT_LOOKUP_MIGRATION_MISMATCH';
  end if;
  execute pg_catalog.replace(v_definition, v_target, v_replacement);
end;
$$;
