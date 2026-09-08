-- Forward-only correction for the applied Task 2 cart validator. PostgreSQL
-- has no jsonb_object_length(jsonb); retain every other reservation behavior.
do $$
declare
  v_definition text;
  v_target text := 'jsonb_object_length(v_item) <> 2';
  v_replacement text := '(select count(*) from jsonb_object_keys(v_item)) <> 2';
begin
  select pg_catalog.pg_get_functiondef(
    'private.reserve_checkout(uuid,jsonb,text,text,uuid,text)'::regprocedure
  ) into v_definition;

  if v_definition is null
    or pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_target, '')
    ) <> pg_catalog.length(v_target) then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_CART_VALIDATOR_MIGRATION_MISMATCH';
  end if;

  execute pg_catalog.replace(v_definition, v_target, v_replacement);
end;
$$;
