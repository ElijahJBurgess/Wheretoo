import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Core Ticket Truth Lite migration guard', () => {
  it('rejects existing tickets before schema or fulfillment replacement', () => {
    const path = 'supabase/migrations/20260907010000_integrate_core_ticket_truth_lite_fulfillment.sql'
    expect(existsSync(path)).toBe(true)
    const sql = readFileSync(path, 'utf8').replace(/--[^\n]*/g, '').trim()
    expect(sql).toMatch(/^do\s+\$\$/i)
    const firstBlock = sql.slice(0, sql.indexOf('$$;', 5) + 3)
    expect(firstBlock).toMatch(/if exists\s*\(select 1 from public\.tickets\)/i)
    expect(firstBlock).toContain('LITE_EXISTING_TICKETS_REQUIRE_DECISION')
    for (const match of sql.matchAll(/alter table public\.tickets|(?:create|drop)(?: or replace)? function (?:private\.fulfill_paid_order|public\.server_fulfill_paid_order)/gi)) {
      expect(match.index).toBeGreaterThan(firstBlock.length - 1)
    }
  })
})
