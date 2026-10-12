import { describe, expect, it } from 'vitest'
import { getDevelopmentMapEvents } from './developmentMapEvents'

describe('development map fixture modes', () => {
  it('keeps normal map inventory at the original five events', () => {
    expect(getDevelopmentMapEvents('').map(({ id, animationPreset }) => ({ id, animationPreset }))).toEqual([
      { id: 'oakland-day-party', animationPreset: 'generic' },
      { id: 'oakland-vinyl-night', animationPreset: 'generic' },
      { id: 'oakland-taco-social', animationPreset: 'generic' },
      { id: 'oakland-outdoor-cinema', animationPreset: 'generic' },
      { id: 'oakland-morning-run-club', animationPreset: 'generic' },
    ])
  })

  it('provides exactly 50 unique deterministic events only for the dense allowlist value', () => {
    const events = getDevelopmentMapEvents('?mapFixture=dense')
    expect(events).toHaveLength(50)
    expect(new Set(events.map(({ id }) => id))).toHaveLength(50)
    expect(getDevelopmentMapEvents('?mapFixture=unknown')).toHaveLength(5)
  })

  it('adds three distinct events at Day Party coordinates for colocated proof', () => {
    const events = getDevelopmentMapEvents('?mapFixture=colocated')
    const colocated = events.filter(({ longitude, latitude }) => longitude === -122.259 && latitude === 37.807)
    expect(events).toHaveLength(8)
    expect(colocated).toHaveLength(4)
    expect(new Set(colocated.map(({ id }) => id))).toHaveLength(4)
    expect(new Set(colocated.map(({ title }) => title))).toHaveLength(4)
  })

  it.each(['', '?mapFixture=dense', '?mapFixture=colocated'])('assigns the library version to Day Party only for %s', (search) => {
    expect(getDevelopmentMapEvents(search).filter(({ mapIconVersionId }) => mapIconVersionId !== null).map(({ id }) => id))
      .toEqual(['oakland-day-party'])
  })
})
