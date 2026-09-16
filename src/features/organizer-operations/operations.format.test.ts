import { describe, expect, it } from 'vitest'
import { dateTime, timeZoneLabel } from './operations.format'

describe('dateTime', () => {
  it('returns a safe fallback for an invalid stored timezone', () => {
    expect(dateTime('2026-09-20T02:00:00Z', 'Invalid/Timezone')).toBe('Date unavailable')
    expect(timeZoneLabel('Invalid/Timezone')).toBe('Timezone unavailable')
  })
})
