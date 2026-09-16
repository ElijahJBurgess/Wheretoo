-- Spec08 approved correction: restore the existing 1–10 preflight tier-ID contract.
-- Preserve the later Connect-status refresh logic and all quantity/reservation rules.
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
