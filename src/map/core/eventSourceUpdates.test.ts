import { describe, expect, it, vi } from 'vitest'
import { createEventSourceUpdates } from './eventSourceUpdates'
import { toEventFeatureCollection } from '../data/eventGeoJson'
import { getDevelopmentMapEvents } from '../data/developmentMapEvents'

function setup() {
  const listeners = new Set<() => void>()
  const source = { setData: vi.fn() }
  const map = {
    getSource: vi.fn(() => source), isSourceLoaded: vi.fn(() => false),
    on: vi.fn((_type: 'render', listener: () => void) => listeners.add(listener)),
    off: vi.fn((_type: 'render', listener: () => void) => listeners.delete(listener)), triggerRepaint: vi.fn(),
  }
  const error = vi.fn(), updates = createEventSourceUpdates(map, error)
  return { map, source, updates, error, render: () => [...listeners].forEach(listener => listener()), listeners }
}
const empty = toEventFeatureCollection([]), rows = toEventFeatureCollection(getDevelopmentMapEvents())
describe('event source updates', () => {
  it('commits authoritative empty data only after earlier icon tile work finishes', () => {
    const f = setup()
    f.updates.write('events', empty)
    f.render(); expect(f.source.setData).not.toHaveBeenCalled()
    f.map.isSourceLoaded.mockReturnValue(true)
    f.render(); expect(f.source.setData).toHaveBeenCalledExactlyOnceWith(empty)
    expect(f.listeners.size).toBe(0)
  })
  it('coalesces rapid nonempty/empty/nonempty updates to the newest result', () => {
    const f = setup()
    f.updates.write('events', rows); f.updates.write('events', empty); f.updates.write('events', rows)
    expect(f.listeners.size).toBe(1)
    f.map.isSourceLoaded.mockReturnValue(true); f.render()
    expect(f.source.setData).toHaveBeenCalledExactlyOnceWith(rows)
    expect(f.listeners.size).toBe(0)
  })
  it('does not apply a queued result to a replacement style source', () => {
    const f = setup(), replacement = { setData: vi.fn() }
    f.updates.write('events', empty)
    f.map.getSource.mockReturnValue(replacement); f.map.isSourceLoaded.mockReturnValue(true); f.render()
    expect(replacement.setData).not.toHaveBeenCalled(); expect(f.listeners.size).toBe(0)
  })
  it('releases pending work and listeners on teardown', () => {
    const f = setup(); f.updates.write('events', empty); f.updates.dispose()
    f.map.isSourceLoaded.mockReturnValue(true); f.render()
    expect(f.source.setData).not.toHaveBeenCalled(); expect(f.listeners.size).toBe(0)
  })
  it('reports renderer failures and releases the listener', () => {
    const f = setup(); f.updates.write('events', empty); f.map.isSourceLoaded.mockReturnValue(true)
    f.source.setData.mockImplementation(() => { throw new Error('renderer unavailable') }); f.render()
    expect(f.error).toHaveBeenCalledOnce(); expect(f.listeners.size).toBe(0)
  })
})
