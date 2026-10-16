import { describe, expect, it, vi } from 'vitest'
import { getDevelopmentMapEvents } from '../data/developmentMapEvents'
import { EVENT_LAYER_IDS, EVENT_SOURCE_ID, SELECTED_EVENT_SOURCE_ID, createUnselectedFilter } from '../style/eventLayers'
import { installEventLayers, updateEventCollection, updateEventMarkerSizing, updateEventSelection } from './eventLayerController'

function rendererDouble() {
  return {
    addSource: vi.fn(), addLayer: vi.fn(), setFilter: vi.fn(), getSource: vi.fn(), getLayer: vi.fn(),
    setPaintProperty: vi.fn(), setLayoutProperty: vi.fn(),
  }
}

describe('event layer controller', () => {
  it('installs one clustered inventory source and one empty selected presentation source', () => {
    const map = rendererDouble()
    installEventLayers(map, getDevelopmentMapEvents(), false, null)

    expect(map.addSource).toHaveBeenCalledTimes(2)
    expect(map.addSource).toHaveBeenCalledWith(EVENT_SOURCE_ID, expect.objectContaining({
      type: 'geojson', cluster: true, clusterRadius: 50, clusterMaxZoom: 14, clusterMinPoints: 2,
    }))
    expect(map.addSource).toHaveBeenCalledWith(SELECTED_EVENT_SOURCE_ID, expect.objectContaining({ type: 'geojson', cluster: false }))
    expect(map.addLayer.mock.calls.map(([layer]) => layer.id)).toEqual(Object.values(EVENT_LAYER_IDS))
  })

  it('updates only the selected overlay and unselected filters when selection changes', () => {
    const map = rendererDouble()
    const selected = getDevelopmentMapEvents()[0]
    const setData = vi.fn()
    map.getSource.mockReturnValue({ setData })
    updateEventSelection(map, selected)

    expect(map.setFilter).toHaveBeenCalledTimes(7)
    const hitFilter = createUnselectedFilter('oakland-day-party')
    expect(map.setFilter).toHaveBeenCalledWith(EVENT_LAYER_IDS.hit, hitFilter)
    for (const id of [EVENT_LAYER_IDS.unselectedTail, EVENT_LAYER_IDS.unselectedCircle, EVENT_LAYER_IDS.unselectedGlyph]) {
      expect(map.setFilter).toHaveBeenCalledWith(id, hitFilter)
    }
    for (const id of [EVENT_LAYER_IDS.selectedTail, EVENT_LAYER_IDS.selectedCircle, EVENT_LAYER_IDS.selectedGlyph]) {
      expect(map.setFilter).toHaveBeenCalledWith(id, ['!', ['has', 'point_count']])
    }
    expect(setData.mock.calls[0][0].features).toHaveLength(1)
    expect(setData.mock.calls[0][0].features[0].id).toBe('oakland-day-party')
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
  })

  it('uses setData for real inventory changes without recreating sources', () => {
    const map = rendererDouble()
    const setData = vi.fn()
    map.getSource.mockReturnValue({ setData })
    updateEventCollection(map, getDevelopmentMapEvents())
    expect(setData.mock.calls[0][0].features).toHaveLength(5)
    expect(map.addSource).not.toHaveBeenCalled()
  })

  it('hides the flag-image fallback pieces without disabling its hit target or selected context', () => {
    const map = rendererDouble()
    const selected = getDevelopmentMapEvents()[0]
    map.getSource.mockReturnValue({ setData: vi.fn() })

    updateEventSelection(map, selected, ['version-a'])

    const hitFilter = createUnselectedFilter('oakland-day-party')
    const hiddenUnselected = ['all', hitFilter, ['!', ['in', ['get', 'mapIconVersionId'], ['literal', ['version-a']]]]]
    const hiddenSelected = ['all', ['!', ['has', 'point_count']], ['!', ['in', ['get', 'mapIconVersionId'], ['literal', ['version-a']]]]]
    expect(map.setFilter).toHaveBeenCalledWith(EVENT_LAYER_IDS.hit, hitFilter)
    for (const id of [EVENT_LAYER_IDS.unselectedTail, EVENT_LAYER_IDS.unselectedCircle, EVENT_LAYER_IDS.unselectedGlyph]) {
      expect(map.setFilter).toHaveBeenCalledWith(id, hiddenUnselected)
    }
    for (const id of [EVENT_LAYER_IDS.selectedTail, EVENT_LAYER_IDS.selectedCircle, EVENT_LAYER_IDS.selectedGlyph]) {
      expect(map.setFilter).toHaveBeenCalledWith(id, hiddenSelected)
    }
    for (const id of [EVENT_LAYER_IDS.selectedHit, EVENT_LAYER_IDS.selectedHalo, EVENT_LAYER_IDS.selectedTitle]) {
      expect(map.setFilter).not.toHaveBeenCalledWith(id, expect.anything())
    }
  })

  it('updates responsive paint and layout properties without reconstructing source or layers', () => {
    const map = rendererDouble()
    updateEventMarkerSizing(map, true, 'oakland-day-party')

    expect(map.setPaintProperty).toHaveBeenCalledWith(EVENT_LAYER_IDS.unselectedCircle, 'circle-radius', 21)
    expect(map.setPaintProperty).toHaveBeenCalledWith(EVENT_LAYER_IDS.hit, 'circle-radius', 24)
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
  })
})

it('skips equal GeoJSON snapshots but publishes changed geometry and cleared selection', () => {
  const map = rendererDouble(), inventory = { setData: vi.fn() }, selected = { setData: vi.fn() }
  map.getSource.mockImplementation(id => id === EVENT_SOURCE_ID ? inventory : selected)
  const events = getDevelopmentMapEvents()
  updateEventCollection(map, events); updateEventSelection(map, events[0])
  updateEventCollection(map, events.map(e => ({ ...e }))); updateEventSelection(map, { ...events[0] })
  expect(inventory.setData).toHaveBeenCalledTimes(1)
  expect(selected.setData).toHaveBeenCalledTimes(1)
  updateEventCollection(map, [{ ...events[0], longitude: -122.4 }]); updateEventSelection(map, null)
  expect(inventory.setData).toHaveBeenCalledTimes(2)
  expect(selected.setData).toHaveBeenCalledTimes(2)
  expect(selected.setData.mock.lastCall?.[0].features).toEqual([])
})
it('updates a replacement source even if its payload matches a removed source', () => {
  const map = rendererDouble(), first = { setData: vi.fn() }, replacement = { setData: vi.fn() }
  map.getSource.mockReturnValue(first)
  updateEventCollection(map, getDevelopmentMapEvents())
  map.getSource.mockReturnValue(replacement)
  updateEventCollection(map, getDevelopmentMapEvents())
  expect(replacement.setData).toHaveBeenCalledOnce()
})
