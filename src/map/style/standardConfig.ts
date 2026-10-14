import type { ConfigSpecification } from 'mapbox-gl/esm'
import { MOBILE_MAP_BREAKPOINT } from '../core/map.constants'

export function createWheretooStandardConfig(containerWidth: number) {
  return {
    lightPreset: 'night',
    theme: 'monochrome',
    font: 'Manrope',
    showPointOfInterestLabels: true,
    showRoadLabels: true,
    showPedestrianRoads: true,
    showPlaceLabels: true,
    densityPointOfInterestLabels: containerWidth < MOBILE_MAP_BREAKPOINT ? 2 : 3,
    colorModePointOfInterestLabels: 'single',
    // Standard's monochrome night preset derives readable gray labels and
    // charcoal surfaces from its native colors; dark overrides crush detail.
    backgroundPointOfInterestLabels: 'none',
    showTransitLabels: false,
    showLandmarkIcons: false,
    showLandmarkIconLabels: false,
    showIndoor: false,
    showIndoorLabels: false,
    show3dObjects: true,
    show3dBuildings: true,
    show3dFacades: false,
    show3dLandmarks: false,
    show3dTrees: false,
  } as const satisfies ConfigSpecification
}
