import { expect, it } from 'vitest'
import { nextDiscoveryMidnight } from './discovery.time'

it.each([
  ['2026-03-08T08:00:00Z', '2026-03-09T07:00:00Z'],
  ['2026-11-01T07:00:00Z', '2026-11-02T08:00:00Z'],
  ['2026-09-14T06:59:59Z', '2026-09-14T07:00:00Z'],
])('schedules server-window renewal at LA midnight across DST: %s', (now, expected) => {
  expect(new Date(nextDiscoveryMidnight(Date.parse(now))).toISOString()).toBe(new Date(expected).toISOString())
})
