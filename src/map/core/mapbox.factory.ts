import { Map, NavigationControl, supported, type MapOptions } from 'mapbox-gl/esm'
import { createWheretooStandardConfig } from '../style/standardConfig'
import {
  DEFAULT_DESKTOP_CAMERA, DEFAULT_MOBILE_CAMERA, MAP_ARIA_LABEL, MAP_MAX_ZOOM,
  MAP_MIN_ZOOM, MAP_STYLE_URL, SERVICE_BOUNDS,
} from './map.constants'

type CreateMapOptionsInput = { container: HTMLElement; accessToken: string; mobile: boolean; cooperativeGestures?: boolean }

export function createMapOptions({ container, accessToken, mobile, cooperativeGestures = false }: CreateMapOptionsInput): MapOptions {
  const camera = mobile ? DEFAULT_MOBILE_CAMERA : DEFAULT_DESKTOP_CAMERA
  return {
    accessToken,
    container,
    cooperativeGestures,
    style: MAP_STYLE_URL,
    projection: 'mercator',
    language: 'en',
    center: camera.center,
    zoom: camera.zoom,
    pitch: camera.pitch,
    bearing: camera.bearing,
    minPitch: 0,
    maxPitch: 45,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    maxBounds: SERVICE_BOUNDS,
    renderWorldCopies: false,
    antialias: true,
    attributionControl: true,
    logoPosition: 'bottom-left',
    respectPrefersReducedMotion: true,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    locale: { 'Map.Title': MAP_ARIA_LABEL },
    config: { basemap: createWheretooStandardConfig(container.clientWidth) },
  }
}

export function isMapboxSupported() { return supported() }
export function createMapboxMap(options: MapOptions) { return new Map(options) }
export function createNavigationControl() { return new NavigationControl({ showCompass: false }) }
