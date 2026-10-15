import type { MapCamera } from './map.types'

export const MAP_STYLE_URL = 'mapbox://styles/mapbox/standard'
export const MAP_ARIA_LABEL = 'Interactive Wheretoo map of the Bay Area'
export const MAP_MIN_ZOOM = 9.5
export const MAP_MAX_ZOOM = 16.25
export const MOBILE_MAP_BREAKPOINT = 768
export const SERVICE_BOUNDS: [[number, number], [number, number]] = [[-123.6, 36.8], [-121, 38.9]]

export const DEFAULT_DESKTOP_CAMERA: MapCamera = {
  center: [-122.263, 37.804], zoom: 14.6, pitch: 25, bearing: 0,
}
export const DEFAULT_MOBILE_CAMERA: MapCamera = {
  center: [-122.263, 37.804], zoom: 14.8, pitch: 12, bearing: 0,
}
