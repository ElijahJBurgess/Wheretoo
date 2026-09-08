-- Include-only test helper. These synthetic hashes are never admission credentials.
-- pg_temp keeps the helper scoped to the caller's test session.
create function pg_temp.ticket_manifest(p_order_id uuid)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_agg(
    jsonb_build_object(
      'order_item_id', items.id,
      'unit_sequence', units.unit_sequence,
      'admission_label', items.tier_name,
      'credential_hash', encode(
        extensions.digest(items.id::text || ':' || units.unit_sequence::text, 'sha256'),
        'hex'
      )
    )
    order by items.id, units.unit_sequence
  )
  from public.order_items as items
  cross join lateral generate_series(1, items.quantity) as units(unit_sequence)
  where items.order_id = p_order_id;
$$;
