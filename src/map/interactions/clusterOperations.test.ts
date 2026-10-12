import { describe, expect, it, vi } from 'vitest'
import { ClusterInteractionGuard, getClusterExpansionZoom, getCompleteClusterEventIds } from './clusterOperations'

describe('cluster operations', () => {
  it('adapts Mapbox 3.29 callback expansion zoom without awaiting its return value', async () => {
    const source = { getClusterExpansionZoom: vi.fn((_id, callback) => { callback(null, 15); return source }) }
    await expect(getClusterExpansionZoom(source, 7)).resolves.toBe(15)
    expect(source.getClusterExpansionZoom).toHaveBeenCalledWith(7, expect.any(Function))
  })

  it('retrieves every leaf in explicit 100-item pages and deduplicates IDs', async () => {
    const all = Array.from({ length: 205 }, (_, index) => ({ properties: { eventId: `event-${index}` } }))
    const source = { getClusterLeaves: vi.fn((_id, limit, offset, callback) => {
      callback(null, all.slice(offset, offset + limit)); return source
    }) }
    const ids = await getCompleteClusterEventIds(source, 3, 205, 205, () => true)
    expect(ids).toHaveLength(205)
    expect(source.getClusterLeaves.mock.calls.map((call) => call.slice(1, 3))).toEqual([[100, 0], [100, 100], [5, 200]])
  })

  it('rejects incomplete or stale membership instead of opening a partial chooser', async () => {
    const incomplete = { getClusterLeaves: vi.fn((_id, _limit, _offset, callback) => { callback(null, [{ properties: { eventId: 'one' } }]); return incomplete }) }
    await expect(getCompleteClusterEventIds(incomplete, 1, 2, 2, () => true)).rejects.toThrow('incomplete')
    await expect(getCompleteClusterEventIds(incomplete, 1, 2, 2, () => false)).rejects.toThrow('stale')
  })

  it('invalidates callbacks after a newer interaction or source revision', () => {
    const guard = new ClusterInteractionGuard()
    const first = guard.begin()
    expect(guard.isCurrent(first)).toBe(true)
    guard.begin()
    expect(guard.isCurrent(first)).toBe(false)
    const current = guard.begin()
    guard.advanceSourceRevision()
    expect(guard.isCurrent(current)).toBe(false)
  })
})
