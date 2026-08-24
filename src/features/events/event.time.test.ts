import { describe, expect, it } from 'vitest'
import {
  instantToLosAngelesWallTime,
  losAngelesWallTimeToInstant,
  losAngelesWallTimeToIso,
} from './event.time'

describe('Los Angeles event wall-time adapter', () => {
  it.each([
    ['2026-01-15T20:30:00.000Z', '2026-01-15T12:30'],
    ['2026-07-15T19:30:00.000Z', '2026-07-15T12:30'],
  ])('formats persisted %s as fixed-zone wall time %s', (instant, wallTime) => {
    expect(instantToLosAngelesWallTime(instant)).toBe(wallTime)
    expect(losAngelesWallTimeToIso(wallTime)).toBe(instant)
  })

  it.each([
    '2026-02-30T12:00',
    '2026-03-08T02:00',
    '2026-03-08T02:30',
    '2026-03-08T02:59',
    '2026-01-15T24:00',
    '2026-01-15T12:00:00',
  ])('rejects invalid or nonexistent wall time %s', (wallTime) => {
    expect(losAngelesWallTimeToInstant(wallTime)).toBeNull()
    expect(losAngelesWallTimeToIso(wallTime)).toBeNull()
  })

  it('chooses the earliest instant for the repeated fall-back hour', () => {
    expect(losAngelesWallTimeToIso('2026-11-01T01:30')).toBe('2026-11-01T08:30:00.000Z')
    expect(instantToLosAngelesWallTime('2026-11-01T09:30:00.000Z')).toBe('2026-11-01T01:30')
  })

  it.each(['', 'not-an-instant', '2026-02-30T12:00:00.000Z'])(
    'does not format invalid persisted instant %s',
    (instant) => {
      expect(instantToLosAngelesWallTime(instant)).toBe('')
    },
  )
})
