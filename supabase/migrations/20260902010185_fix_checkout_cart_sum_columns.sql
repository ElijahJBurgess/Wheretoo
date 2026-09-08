-- Qualify the remaining cross-row invariant columns, which otherwise collide
-- with RETURNS TABLE output names in PL/pgSQL.
do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'private.reserve_checkout(uuid,jsonb,text,text,uuid,text)'::regprocedure
  ) into v_definition;
  if v_definition is null
    or pg_catalog.strpos(v_definition, 'sum(quantity)') = 0
    or pg_catalog.strpos(v_definition, 'sum(subtotal_minor)') = 0 then
    raise exception using errcode = 'P0001', message = 'CHECKOUT_CART_SUM_COLUMNS_MIGRATION_MISMATCH';
  end if;
  execute pg_catalog.replace(
    pg_catalog.replace(v_definition, 'sum(quantity)', 'sum(items.quantity)'),
    'sum(subtotal_minor)', 'sum(items.subtotal_minor)'
  );
end;
$$;
