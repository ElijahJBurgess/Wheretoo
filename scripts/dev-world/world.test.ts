import { describe, expect, it } from 'vitest'
import { assertDevelopmentTarget, renderSeedSql } from './world'
import { demoEvents, demoOrganizerId } from '../../src/preview/devWorldCatalog'

describe('persistent buyer world guards', () => {
  const valid = { projectRef: 'abcdefghijklmnopqrst', url: 'https://abcdefghijklmnopqrst.supabase.co', key: 'pk_test_fixture', environment: 'development', connectedAccount: 'acct_fixture' }
  it('accepts only the exact linked development TEST target', () => {
    expect(() => assertDevelopmentTarget(valid)).not.toThrow()
    for (const change of [{ environment: 'production' }, { key: 'pk_live_fixture' }, { url: 'https://other.supabase.co' }, { connectedAccount: '' }]) {
      expect(() => assertDevelopmentTarget({ ...valid, ...change })).toThrow()
    }
  })
  it('uses distinct stable identities and one canonical event across reruns', () => {
    expect(demoEvents).toHaveLength(7)
    expect(new Set([demoOrganizerId, ...demoEvents.map(e => e.id)]).size).toBe(8)
    expect(demoEvents.filter(e => e.paid)).toHaveLength(1)
    expect(renderSeedSql('acct_fixture', 'seed')).toBe(renderSeedSql('acct_fixture', 'seed'))
  })
  it('never resets financial truth, deletes rows, or creates Stripe accounts', () => {
    const sql = renderSeedSql('acct_fixture', 'reset')
    expect(sql).not.toMatch(/\bdelete\b|\btruncate\b|insert into public\.(orders|tickets)|update public\.(orders|tickets)/i)
    expect(sql).toContain('pg_advisory_xact_lock')
    expect(sql).toContain("environment = 'development'")
    expect(sql).toContain('WORLD_IDENTITY_CONFLICT')
    expect(sql).toContain('sum(items.quantity)')
  })
  it('rejects SQL-shaped account input before rendering', () => {
    expect(() => renderSeedSql("acct_'; drop table events;--", 'seed')).toThrow()
  })
})
