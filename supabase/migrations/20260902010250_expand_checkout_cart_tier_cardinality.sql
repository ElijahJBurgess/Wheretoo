-- Forward-only correction for Checkout's request contract. Event authoring
-- still permits at most three configured tier types; the service boundary
-- independently accepts one to ten distinct requested tier identifiers.
do $$
declare
  v_definition text;
  v_target text := 'cardinality(p_tier_ids) not between 1 and 3';
  v_replacement text := 'cardinality(p_tier_ids) not between 1 and 10';
begin
  select pg_catalog.pg_get_functiondef(
    'private.get_checkout_preflight(uuid,uuid[])'::regprocedure
  ) into v_definition;

  if v_definition is null
    or pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_target, '')
    ) <> pg_catalog.length(v_target) then
    raise exception using
      errcode = 'P0001',
      message = 'CHECKOUT_PREFLIGHT_CARDINALITY_MIGRATION_MISMATCH';
  end if;

  execute pg_catalog.replace(v_definition, v_target, v_replacement);
end;
$$;

do $$
declare
  v_definition text;
  v_target text := 'jsonb_array_length(p_items) not between 1 and 3';
  v_replacement text := 'jsonb_array_length(p_items) not between 1 and 10';
begin
  select pg_catalog.pg_get_functiondef(
    'private.reserve_checkout(uuid,jsonb,text,text,uuid,text)'::regprocedure
  ) into v_definition;

  if v_definition is null
    or pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_target, '')
    ) <> pg_catalog.length(v_target) then
    raise exception using
      errcode = 'P0001',
      message = 'CHECKOUT_RESERVATION_CARDINALITY_MIGRATION_MISMATCH';
  end if;

  execute pg_catalog.replace(v_definition, v_target, v_replacement);
end;
$$;
