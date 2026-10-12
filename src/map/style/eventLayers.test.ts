import { describe, expect, it } from 'vitest'
import {
  EVENT_LAYER_IDS, EVENT_SOURCE_ID, SELECTED_EVENT_SOURCE_ID, createEventLayers, createUnselectedFilter,
} from './eventLayers'

describe('event layers', () => {
  it('uses one source and the required visual order without private basemap layer ids', () => {
    const layers = createEventLayers({ mobile: false, selectedEventId: null })

    expect(EVENT_SOURCE_ID).toBe('wheretoo-events')
    expect(layers.map((layer) => layer.id)).toEqual([
      EVENT_LAYER_IDS.clusterHit,
      EVENT_LAYER_IDS.clusterCircle,
      EVENT_LAYER_IDS.clusterCount,
      EVENT_LAYER_IDS.hit,
      EVENT_LAYER_IDS.unselectedTail,
      EVENT_LAYER_IDS.unselectedCircle,
      EVENT_LAYER_IDS.unselectedGlyph,
      EVENT_LAYER_IDS.selectedHit,
      EVENT_LAYER_IDS.selectedHalo,
      EVENT_LAYER_IDS.selectedTail,
      EVENT_LAYER_IDS.selectedCircle,
      EVENT_LAYER_IDS.selectedGlyph,
      EVENT_LAYER_IDS.selectedTitle,
    ])
    expect(layers.slice(0, 7).every((layer) => layer.source === EVENT_SOURCE_ID)).toBe(true)
    expect(layers.slice(7).every((layer) => layer.source === SELECTED_EVENT_SOURCE_ID)).toBe(true)
    expect(layers.every((layer) => layer.slot === 'top')).toBe(true)
    expect(JSON.stringify(layers)).not.toMatch(/road-label|poi-label|building-/)
  })

  it('uses approved responsive marker geometry and a 44–48px hit area', () => {
    const desktop = createEventLayers({ mobile: false, selectedEventId: null })
    const mobile = createEventLayers({ mobile: true, selectedEventId: null })
    const byId = (layers: ReturnType<typeof createEventLayers>, id: string) => layers.find((layer) => layer.id === id)

    expect(byId(desktop, EVENT_LAYER_IDS.unselectedCircle)?.paint).toMatchObject({ 'circle-radius': 19, 'circle-stroke-width': 3 })
    expect(byId(mobile, EVENT_LAYER_IDS.unselectedCircle)?.paint).toMatchObject({ 'circle-radius': 21, 'circle-stroke-width': 3 })
    expect(byId(desktop, EVENT_LAYER_IDS.selectedCircle)?.paint).toMatchObject({ 'circle-radius': 22.5 })
    expect(byId(mobile, EVENT_LAYER_IDS.selectedCircle)?.paint).toMatchObject({ 'circle-radius': 25 })
    expect(byId(desktop, EVENT_LAYER_IDS.selectedHalo)?.paint).toMatchObject({ 'circle-radius': 29 })
    expect(byId(mobile, EVENT_LAYER_IDS.selectedHalo)?.paint).toMatchObject({ 'circle-radius': 31 })
    expect(byId(desktop, EVENT_LAYER_IDS.hit)?.paint).toMatchObject({ 'circle-radius': 22 })
    expect(byId(mobile, EVENT_LAYER_IDS.hit)?.paint).toMatchObject({ 'circle-radius': 24 })
    expect(byId(desktop, EVENT_LAYER_IDS.clusterCircle)?.paint).toMatchObject({
      'circle-color': '#353B48', 'circle-stroke-color': '#AEB4C1', 'circle-stroke-width': 3,
      'circle-radius': ['step', ['get', 'point_count'], 22, 10, 25, 50, 28],
    })
    expect(byId(desktop, EVENT_LAYER_IDS.clusterHit)?.paint).toMatchObject({
      'circle-radius': ['step', ['get', 'point_count'], 25, 10, 28, 50, 31],
    })
  })

  it('keeps visible marker paint independent of night lighting and reserves purple for selection', () => {
    const layers = createEventLayers({ mobile: false, selectedEventId: null })
    for (const layer of layers) {
      if (layer.type === 'circle' && !layer.id.includes('hit-area')) expect(layer.paint?.['circle-emissive-strength']).toBe(1)
      if (layer.type === 'symbol') expect(layer.paint?.['text-emissive-strength']).toBe(1)
    }
    expect(layers.find(layer => layer.id === EVENT_LAYER_IDS.unselectedCircle)?.paint).toMatchObject({ 'circle-color': '#353B48' })
    expect(layers.find(layer => layer.id === EVENT_LAYER_IDS.selectedCircle)?.paint).toMatchObject({ 'circle-color': '#6D4AFF' })
  })

  it('filters selected and unselected layers by application selection state', () => {
    const layers = createEventLayers({ mobile: false, selectedEventId: 'oakland-day-party' })
    const unselectedHitFilter = createUnselectedFilter('oakland-day-party')

    expect(layers.find((layer) => layer.id === EVENT_LAYER_IDS.hit)?.filter).toEqual(unselectedHitFilter)
    for (const id of [EVENT_LAYER_IDS.unselectedTail, EVENT_LAYER_IDS.unselectedCircle, EVENT_LAYER_IDS.unselectedGlyph]) {
      expect(layers.find((layer) => layer.id === id)?.filter).toEqual(unselectedHitFilter)
    }
    for (const id of [EVENT_LAYER_IDS.selectedTail, EVENT_LAYER_IDS.selectedCircle, EVENT_LAYER_IDS.selectedGlyph]) {
      expect(layers.find((layer) => layer.id === id)?.filter).toEqual(['!', ['has', 'point_count']])
    }
    expect(layers.find((layer) => layer.id === EVENT_LAYER_IDS.selectedHit)?.filter).toEqual(['!', ['has', 'point_count']])
    expect(layers.find((layer) => layer.id === EVENT_LAYER_IDS.selectedHalo)?.filter).toEqual(['!', ['has', 'point_count']])
    expect(layers.find((layer) => layer.id === EVENT_LAYER_IDS.selectedTitle)?.filter).toEqual(['!', ['has', 'point_count']])
    const individualIds = [EVENT_LAYER_IDS.hit, EVENT_LAYER_IDS.unselectedTail, EVENT_LAYER_IDS.unselectedCircle, EVENT_LAYER_IDS.unselectedGlyph]
    expect(individualIds.every((id) => JSON.stringify(layers.find((layer) => layer.id === id)?.filter).includes('point_count'))).toBe(true)
  })

  it('hides only the six fallback badge pieces when the flag image is ready and eligible', () => {
    const layers = createEventLayers({ mobile: false, selectedEventId: 'oakland-day-party', readyVersions: ['version-a'] })
    const unselected = createUnselectedFilter('oakland-day-party')
    const hiddenUnselected = ['all', unselected, ['!', ['in', ['get', 'mapIconVersionId'], ['literal', ['version-a']]]]]
    const hiddenSelected = ['all', ['!', ['has', 'point_count']], ['!', ['in', ['get', 'mapIconVersionId'], ['literal', ['version-a']]]]]

    expect(layers.find((layer) => layer.id === EVENT_LAYER_IDS.hit)?.filter).toEqual(unselected)
    for (const id of [EVENT_LAYER_IDS.unselectedTail, EVENT_LAYER_IDS.unselectedCircle, EVENT_LAYER_IDS.unselectedGlyph]) {
      expect(layers.find((layer) => layer.id === id)?.filter).toEqual(hiddenUnselected)
    }
    for (const id of [EVENT_LAYER_IDS.selectedTail, EVENT_LAYER_IDS.selectedCircle, EVENT_LAYER_IDS.selectedGlyph]) {
      expect(layers.find((layer) => layer.id === id)?.filter).toEqual(hiddenSelected)
    }
    for (const id of [EVENT_LAYER_IDS.selectedHit, EVENT_LAYER_IDS.selectedHalo, EVENT_LAYER_IDS.selectedTitle]) {
      expect(layers.find((layer) => layer.id === id)?.filter).toEqual(['!', ['has', 'point_count']])
    }
  })
})
