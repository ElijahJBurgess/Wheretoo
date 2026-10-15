import { describe, expect, it } from 'vitest'
import type { WheretooMapEvent } from '../data/wheretooMapEvents'
import { reconcileSelectedEventId } from './mapSelection'

const event = { id: 'selected-event' } as WheretooMapEvent

describe('reconcileSelectedEventId', () => {
  it('clears a stored selection when a replacement collection removes the event', () => {
    expect(reconcileSelectedEventId('selected-event', [])).toBeNull()
  })

  it('retains a stored selection while the replacement collection still contains it', () => {
    expect(reconcileSelectedEventId('selected-event', [event])).toBe('selected-event')
  })
})
