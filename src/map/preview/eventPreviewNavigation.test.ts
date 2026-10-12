import { describe, expect, it } from 'vitest'
import { resolveEventPreviewNavigation } from './eventPreviewNavigation'

describe('resolveEventPreviewNavigation', () => {
  it('rejects an unvalidated event ID instead of constructing an event route', () => {
    expect(resolveEventPreviewNavigation('../checkout')).toEqual({ kind: 'unavailable' })
  })

  it('constructs the canonical event route for a UUID', () => {
    expect(resolveEventPreviewNavigation('9F4FCAFA-4C56-4E81-A447-C3C639686D77')).toEqual({
      kind: 'enabled',
      to: '/events/9f4fcafa-4c56-4e81-a447-c3c639686d77',
    })
  })
})
