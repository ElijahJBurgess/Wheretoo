import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationUrl = new URL('../../supabase/migrations/20260902010600_remove_single_ticket_checkout_contract.sql', import.meta.url)
const priorUrl = new URL('../../supabase/migrations/20260902010350_bind_fulfillment_snapshot_lifecycle.sql', import.meta.url)

describe('checkout integrity singular-contract removal', () => {
  it('removes the singular digest while preserving fulfillment guards and canonical eligibility', () => {
    expect(existsSync(migrationUrl)).toBe(true)
    const prior = readFileSync(priorUrl, 'utf8')
    const migration = readFileSync(migrationUrl, 'utf8')
    const body = (sql: string) => sql.slice(sql.indexOf('create or replace function private.fulfill_paid_order('), sql.indexOf('\nrevoke all on function private.fulfill_paid_order('))
    const expected = body(prior)
      .replace('  v_legacy_tier_id uuid;\n', '')
      .replace(/ {2}v_legacy_tier_id :=[^\n]+\n\n {2}-- Cart orders[\s\S]*? {2}v_item_snapshot_valid :=/, '  v_item_snapshot_valid :=')
      .replace(/\n {4}or \(\n {6}v_item_count = 1[\s\S]*?\n {4}\);/, ';')
      // Build 2.5's 10400/10450 eligibility boundary must survive the 10350 body copy.
      .replace(
        "or v_event.status is distinct from 'published'\n    or v_event.admission_type is distinct from 'paid'\n    or v_event.moderation_status not in ('clear', 'flagged')",
        "or not private.event_has_current_public_eligibility(v_event.id)\n    or v_event.admission_type is distinct from 'paid'",
      )
    expect(body(migration)).toBe(expected)
    expect(migration).not.toMatch(/\bcascade\s*;/i)
    const ddl = migration.slice(migration.indexOf('\nrevoke all on function private.fulfill_paid_order('))
    expect(ddl).not.toMatch(/(?:update|delete\s+from|truncate|alter\s+table)\s+(?:public\.)?(?:orders|order_items|tickets|refunds|stripe_webhook_events)\b/i)
  })

  it('routes first paid fulfillment through current public eligibility without an event-end cutoff', () => {
    const migration = readFileSync(migrationUrl, 'utf8')
    const invalidationStart = migration.indexOf('  v_invalidated :=')
    const invalidation = migration.slice(invalidationStart, migration.indexOf(';', invalidationStart))
    expect(invalidation).toContain('or not private.event_has_current_public_eligibility(v_event.id)')
    expect(invalidation).toContain("or v_event.admission_type is distinct from 'paid'")
    expect(invalidation).not.toMatch(/v_event\.(?:status|moderation_status)|event_is_publicly_eligible|v_event\.ends_at/)
  })

  it('retains only generalized checkout, fulfillment, and confirmation Edge request shapes', () => {
    for (const source of [
      '../../supabase/functions/stripe-create-checkout/index.ts',
      '../../supabase/functions/stripe-webhook/index.ts',
      '../../supabase/functions/order-confirmation/index.ts',
    ]) {
      const code = readFileSync(new URL(source, import.meta.url), 'utf8')
      expect(code).not.toMatch(/items\[0\]|quantity\s*(?:===|!==)\s*1\b|p_tier_id\b|deriveConfirmationToken|server_get_webhook_(?:payment_)?order_snapshot|server_lookup_order_confirmation/)
    }
  })
})
