-- Forward-only correction for output-column/column-name ambiguity in the
-- cart's persisted cross-row invariant.
do $$
declare
  v_definition text;
  v_target text := 'from public.order_items where order_id = v_order_id';
  v_replacement text := 'from public.order_items as items where items.order_id = v_order_id';
begin
  select pg_catalog.pg_get_functiondef(
    'private.reserve_checkout(uuid,jsonb,text,text,uuid,text)'::regprocedure
  ) into v_definition;
  if v_definition is null
    or pg_catalog.length(v_definition) - pg_catalog.length(
      pg_catalog.replace(v_definition, v_target, '')
    ) <> 3 * pg_catalog.length(v_target) then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_CART_SUM_MIGRATION_MISMATCH';
  end if;
  execute pg_catalog.replace(v_definition, v_target, v_replacement);
end;
$$;
