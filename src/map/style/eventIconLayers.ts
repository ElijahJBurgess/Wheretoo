import type { ExpressionSpecification, FilterSpecification, LayerSpecification } from 'mapbox-gl/esm'
import type { IconDescriptor } from '../../features/map-icons/icon.api'
import { iconOffset } from '../../features/map-icons/icon.schemas'
import { EVENT_SOURCE_ID, SELECTED_EVENT_SOURCE_ID, individualFilter } from './eventLayers'

export function iconResourceIds(d: IconDescriptor) {
  const prefix = `wheretoo-icon-${d.versionId}-${d.packageHash}`
  return { image: prefix, canonical: `${prefix}-canonical`, body: `${prefix}-canonical-body`, selected: `${prefix}-selected`, selectedBody: `${prefix}-selected-body` }
}

export function createIconLayers(d: IconDescriptor, mobile: boolean, selectedId: string | null): LayerSpecification[] {
  const ids = iconResourceIds(d), m = d.metadata, profile = mobile ? m.mobile : m.desktop
  const matching: FilterSpecification = ['all', individualFilter, ['==', ['get', 'mapIconVersionId'], d.versionId]]
  const layers: LayerSpecification[] = []
  for (const selected of [false, true]) {
    const scale = selected ? m.selectedScale : 1
    const filter: FilterSpecification = selected ? matching : ['all', matching, ['!=', ['get', 'eventId'], selectedId ?? '__none__']]
    const base = { source: selected ? SELECTED_EVENT_SOURCE_ID : EVENT_SOURCE_ID, slot: 'top' as const, filter, minzoom: profile.minZoom, maxzoom: profile.maxZoom }
    layers.push({ ...base, id: selected ? ids.selectedBody : ids.body, type: 'circle', layout: { visibility: 'none' }, paint: {
      'circle-radius': Math.min(64, m.hit.radius * scale), 'circle-color': '#000000', 'circle-opacity': .01,
      'circle-translate': [m.hit.translation[0] * scale, m.hit.translation[1] * scale], 'circle-translate-anchor': 'viewport',
      'circle-pitch-alignment': 'viewport', 'circle-pitch-scale': 'viewport',
    } })
    layers.push({ ...base, id: selected ? ids.selected : ids.canonical, type: 'symbol', layout: {
      visibility: 'none', 'icon-image': ids.image,
      'icon-size': ['interpolate', ['linear'], ['zoom'], ...profile.stops.flatMap(([z, s]) => [z, s * scale])] as ExpressionSpecification,
      'icon-anchor': m.anchor, 'icon-offset': iconOffset(m),
      'icon-pitch-alignment': m.alignment.pitch, 'icon-rotation-alignment': m.alignment.rotation,
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
    }, paint: { 'icon-emissive-strength': 1 } })
  }
  return layers
}
