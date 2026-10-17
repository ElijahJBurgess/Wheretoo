import type { EventSourceWriter } from './eventSourceUpdates'
import type { FilterSpecification, LayerSpecification } from 'mapbox-gl/esm'
import { toEventFeatureCollection } from '../data/eventGeoJson'
import type { WheretooMapEvent } from '../data/wheretooMapEvents'
import {
  EVENT_LAYER_IDS, EVENT_SOURCE_ID, SELECTED_EVENT_SOURCE_ID, createEventLayers,
  createUnselectedFilter, createVisibleSelectedFilter, createVisibleUnselectedFilter,
} from '../style/eventLayers'

type GeoJsonDataSource = { setData(data: ReturnType<typeof toEventFeatureCollection>): unknown }
type EventLayerRenderer = {
  addSource(id: string, source: unknown): unknown; addLayer(layer: LayerSpecification, beforeId?: string): unknown
  getSource(id: string): unknown; getLayer(id: string): unknown; setFilter(layerId: string, filter: FilterSpecification): unknown
  setPaintProperty(layerId: string, name: string, value: unknown): unknown; setLayoutProperty(layerId: string, name: string, value: unknown): unknown
}

const sourceSnapshots = new WeakMap<GeoJsonDataSource, string>()
function setSourceData(target: GeoJsonDataSource | undefined, data: ReturnType<typeof toEventFeatureCollection>, write?: EventSourceWriter, id?: string) {
  if (!target) return
  const snapshot = JSON.stringify(data)
  if (sourceSnapshots.get(target) === snapshot) return
  if (write && id) write(id, data)
  else target.setData(data)
  sourceSnapshots.set(target, snapshot)
}

const emptyCollection = toEventFeatureCollection([])

export function installEventLayers(map: EventLayerRenderer, events: readonly WheretooMapEvent[], mobile: boolean, selectedEvent: WheretooMapEvent | null) {
  const eventCollection = toEventFeatureCollection(events)
  const selectedCollection = selectedEvent ? toEventFeatureCollection([selectedEvent]) : emptyCollection
  const inventorySource = source(map, EVENT_SOURCE_ID)
  const selectedSource = source(map, SELECTED_EVENT_SOURCE_ID)
  if (inventorySource) setSourceData(inventorySource, eventCollection)
  else map.addSource(EVENT_SOURCE_ID, { type: 'geojson', data: eventCollection, cluster: true, clusterRadius: 50, clusterMaxZoom: 14, clusterMinPoints: 2 })
  if (selectedSource) setSourceData(selectedSource, selectedCollection)
  else map.addSource(SELECTED_EVENT_SOURCE_ID, { type: 'geojson', data: selectedCollection, cluster: false })
  if (!inventorySource) { const installed = source(map, EVENT_SOURCE_ID); if (installed) sourceSnapshots.set(installed, JSON.stringify(eventCollection)) }
  if (!selectedSource) { const installed = source(map, SELECTED_EVENT_SOURCE_ID); if (installed) sourceSnapshots.set(installed, JSON.stringify(selectedCollection)) }
  const layers = createEventLayers({ mobile, selectedEventId: selectedEvent?.id ?? null })
  for (const [index, layer] of layers.entries()) {
    if (map.getLayer(layer.id)) continue
    const nextExistingLayer = layers.slice(index + 1).find((candidate) => map.getLayer(candidate.id))
    map.addLayer(layer, nextExistingLayer?.id)
  }
  updateEventSelection(map, selectedEvent)
  updateEventMarkerSizing(map, mobile, selectedEvent?.id ?? null)
}

export function hasCompleteEventLayerInstallation(map: EventLayerRenderer) {
  return Boolean(map.getSource(EVENT_SOURCE_ID)) && Boolean(map.getSource(SELECTED_EVENT_SOURCE_ID))
    && Object.values(EVENT_LAYER_IDS).every((layerId) => Boolean(map.getLayer(layerId)))
}

function source(map: EventLayerRenderer, id: string) { return map.getSource(id) as GeoJsonDataSource | undefined }

export function updateEventCollection(map: EventLayerRenderer, events: readonly WheretooMapEvent[], write?: EventSourceWriter) {
  setSourceData(source(map, EVENT_SOURCE_ID), toEventFeatureCollection(events), write, EVENT_SOURCE_ID)
}

// The selected source is a bounded 0/1 presentation overlay; inventory remains canonical and clustered.
export function updateEventSelection(map: EventLayerRenderer, selectedEvent: WheretooMapEvent | null, readyVersions: readonly string[] = [], write?: EventSourceWriter) {
  const selectedEventId = selectedEvent?.id ?? null
  map.setFilter(EVENT_LAYER_IDS.hit, createUnselectedFilter(selectedEventId))
  const visibleFilter = createVisibleUnselectedFilter(selectedEventId, readyVersions)
  for (const layerId of [EVENT_LAYER_IDS.unselectedTail, EVENT_LAYER_IDS.unselectedCircle, EVENT_LAYER_IDS.unselectedGlyph]) {
    map.setFilter(layerId, visibleFilter)
  }
  const selectedFilter = createVisibleSelectedFilter(readyVersions)
  for (const layerId of [EVENT_LAYER_IDS.selectedTail, EVENT_LAYER_IDS.selectedCircle, EVENT_LAYER_IDS.selectedGlyph]) {
    map.setFilter(layerId, selectedFilter)
  }
  setSourceData(source(map, SELECTED_EVENT_SOURCE_ID), selectedEvent ? toEventFeatureCollection([selectedEvent]) : emptyCollection, write, SELECTED_EVENT_SOURCE_ID)
}

export function updateEventMarkerSizing(map: EventLayerRenderer, mobile: boolean, selectedEventId: string | null) {
  for (const layer of createEventLayers({ mobile, selectedEventId })) {
    if ('paint' in layer && layer.paint) for (const [name, value] of Object.entries(layer.paint)) map.setPaintProperty(layer.id, name, value)
    if ('layout' in layer && layer.layout) for (const [name, value] of Object.entries(layer.layout)) map.setLayoutProperty(layer.id, name, value)
  }
}
