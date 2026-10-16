import { readFileSync } from 'node:fs'
import type { Route } from '@playwright/test'
// Public staging icon IDs only; generated event inventory never reaches the server.
type FixtureRow = Record<string, unknown> & { event_id: string; title: string; timezone: string; venue_label: string | null; starts_at: string; ends_at: string }
export function discoveryRows(count = 9): FixtureRow[] {
  const seed = JSON.parse(readFileSync(new URL('../fixtures/discovery-map.json', import.meta.url), 'utf8')) as FixtureRow[]
  return Array.from({ length: count }, (_, i) => ({ ...seed[i % seed.length],
    event_id: `4f000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    starts_at: new Date(Date.now() + 3600000).toISOString(), ends_at: new Date(Date.now() + 7200000).toISOString(),
  }))
}
export function discoveryMetadata() {
  return { serverNow: new Date().toISOString(), window: { start: new Date().toISOString(), end: new Date(Date.now() + 168 * 3600000).toISOString(), timezone: 'America/Los_Angeles' } }
}
export function fulfillMap(route: Route, rows: Record<string, unknown>[], total = rows.length) {
  return route.fulfill({ json: rows, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range, X-Wheretoo-Discovery', 'X-Wheretoo-Discovery': JSON.stringify(discoveryMetadata()), 'content-range': rows.length ? `0-${rows.length - 1}/${total}` : '*/0' } })
}
