import { describe, expect, it } from 'vitest'
import { uniqueEventIds } from './mapHitTesting'

describe('uniqueEventIds', () => {
  it('deduplicates overlapping event hits and excludes clusters or malformed features', () => {
    expect(uniqueEventIds([
      { properties: { eventId: 'second' } }, { properties: { eventId: 'first' } },
      { properties: { eventId: 'second' } }, { properties: { cluster_id: 4, point_count: 2 } },
    ])).toEqual(['second', 'first'])
  })
})
