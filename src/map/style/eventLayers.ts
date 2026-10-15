import type { FilterSpecification, LayerSpecification } from 'mapbox-gl/esm'

export const EVENT_SOURCE_ID = 'wheretoo-events'
export const SELECTED_EVENT_SOURCE_ID = 'wheretoo-selected-event'
export const WHERETOO_BRAND_PURPLE = '#6D4AFF'

export const EVENT_LAYER_IDS = {
  clusterHit: 'wheretoo-cluster-hit-area', clusterCircle: 'wheretoo-cluster-circle', clusterCount: 'wheretoo-cluster-count',
  hit: 'wheretoo-event-hit-area', unselectedTail: 'wheretoo-event-tail', unselectedCircle: 'wheretoo-event-circle', unselectedGlyph: 'wheretoo-event-glyph',
  selectedHit: 'wheretoo-event-selected-hit-area', selectedHalo: 'wheretoo-event-selected-halo', selectedTail: 'wheretoo-event-selected-tail',
  selectedCircle: 'wheretoo-event-selected-circle', selectedGlyph: 'wheretoo-event-selected-glyph', selectedTitle: 'wheretoo-event-selected-title',
} as const

export const clusterFilter: FilterSpecification = ['has', 'point_count']
export const individualFilter: FilterSpecification = ['!', ['has', 'point_count']]
const noSelectionId = '__wheretoo-no-selection__'

export function createUnselectedFilter(selectedEventId: string | null): FilterSpecification {
  return ['all', individualFilter, ['!=', ['get', 'eventId'], selectedEventId ?? noSelectionId]]
}

export function createVisibleUnselectedFilter(selectedEventId: string | null, readyVersions: readonly string[] = []): FilterSpecification {
  const unselected = createUnselectedFilter(selectedEventId)
  return readyVersions.length ? ['all', unselected, ['!', ['in', ['get', 'mapIconVersionId'], ['literal', [...readyVersions]]]]] : unselected
}

export function createVisibleSelectedFilter(readyVersions: readonly string[] = []): FilterSpecification {
  return readyVersions.length ? ['all', individualFilter, ['!', ['in', ['get', 'mapIconVersionId'], ['literal', [...readyVersions]]]]] : individualFilter
}

export function createEventLayers({ mobile, selectedEventId, readyVersions = [] }: {
  mobile: boolean; selectedEventId: string | null; readyVersions?: readonly string[]
}): LayerSpecification[] {
  const unselected = createUnselectedFilter(selectedEventId)
  const visibleUnselected = createVisibleUnselectedFilter(selectedEventId, readyVersions)
  const visibleSelected = createVisibleSelectedFilter(readyVersions)
  const markerRadius = mobile ? 21 : 19
  const selectedRadius = mobile ? 25 : 22.5
  const inventory = { source: EVENT_SOURCE_ID, slot: 'top' as const }
  const selected = { source: SELECTED_EVENT_SOURCE_ID, slot: 'top' as const, filter: individualFilter }
  return [
    { ...inventory, id: EVENT_LAYER_IDS.clusterHit, type: 'circle', filter: clusterFilter, paint: { 'circle-radius': ['step', ['get', 'point_count'], 25, 10, 28, 50, 31], 'circle-color': '#000', 'circle-opacity': 0.01 } },
    { ...inventory, id: EVENT_LAYER_IDS.clusterCircle, type: 'circle', filter: clusterFilter, paint: { 'circle-emissive-strength': 1, 'circle-radius': ['step', ['get', 'point_count'], 22, 10, 25, 50, 28], 'circle-color': '#353B48', 'circle-stroke-color': '#AEB4C1', 'circle-stroke-width': 3 } },
    { ...inventory, id: EVENT_LAYER_IDS.clusterCount, type: 'symbol', filter: clusterFilter, layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Manrope Bold'], 'text-size': 14, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-emissive-strength': 1, 'text-color': '#FFFFFF' } },
    { ...inventory, id: EVENT_LAYER_IDS.hit, type: 'circle', filter: unselected, paint: { 'circle-emissive-strength': 1, 'circle-radius': mobile ? 24 : 22, 'circle-color': '#000000', 'circle-opacity': 0.01 } },
    { ...inventory, id: EVENT_LAYER_IDS.unselectedTail, type: 'circle', filter: visibleUnselected, paint: { 'circle-emissive-strength': 1, 'circle-radius': 4, 'circle-color': '#353B48', 'circle-stroke-color': '#AEB4C1', 'circle-stroke-width': 2, 'circle-translate': [0, markerRadius + 4] } },
    { ...inventory, id: EVENT_LAYER_IDS.unselectedCircle, type: 'circle', filter: visibleUnselected, paint: { 'circle-emissive-strength': 1, 'circle-radius': markerRadius, 'circle-color': '#353B48', 'circle-stroke-color': '#AEB4C1', 'circle-stroke-width': 3 } },
    { ...inventory, id: EVENT_LAYER_IDS.unselectedGlyph, type: 'symbol', filter: visibleUnselected, layout: { 'text-field': ['get', 'markerGlyph'], 'text-font': ['Manrope Bold'], 'text-size': mobile ? 15 : 14, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-emissive-strength': 1, 'text-color': '#FFFFFF' } },
    { ...selected, id: EVENT_LAYER_IDS.selectedHit, type: 'circle', paint: { 'circle-radius': mobile ? 31 : 29, 'circle-color': '#000', 'circle-opacity': 0.01 } },
    { ...selected, id: EVENT_LAYER_IDS.selectedHalo, type: 'circle', paint: { 'circle-emissive-strength': 1, 'circle-radius': mobile ? 31 : 29, 'circle-color': WHERETOO_BRAND_PURPLE, 'circle-opacity': 0.24 } },
    { ...selected, id: EVENT_LAYER_IDS.selectedTail, type: 'circle', filter: visibleSelected, paint: { 'circle-emissive-strength': 1, 'circle-radius': 4.5, 'circle-color': WHERETOO_BRAND_PURPLE, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2.5, 'circle-translate': [0, selectedRadius + 4] } },
    { ...selected, id: EVENT_LAYER_IDS.selectedCircle, type: 'circle', filter: visibleSelected, paint: { 'circle-emissive-strength': 1, 'circle-radius': selectedRadius, 'circle-color': WHERETOO_BRAND_PURPLE, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 4 } },
    { ...selected, id: EVENT_LAYER_IDS.selectedGlyph, type: 'symbol', filter: visibleSelected, layout: { 'text-field': ['get', 'markerGlyph'], 'text-font': ['Manrope Bold'], 'text-size': mobile ? 17 : 16, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-emissive-strength': 1, 'text-color': '#FFFFFF' } },
    { ...selected, id: EVENT_LAYER_IDS.selectedTitle, type: 'symbol', layout: { 'text-field': ['get', 'title'], 'text-font': ['Manrope Bold'], 'text-size': mobile ? 14 : 13, 'text-anchor': 'top', 'text-offset': [0, mobile ? 2.35 : 2.3], 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-emissive-strength': 1, 'text-color': '#F4F3FA', 'text-halo-color': '#17191F', 'text-halo-width': 2, 'text-halo-blur': 0.5 } },
  ]
}
