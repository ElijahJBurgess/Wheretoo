import { describe, expect, it } from 'vitest'
import { createWheretooStandardConfig } from './standardConfig'

describe('createWheretooStandardConfig', () => {
  it.each([[767, 2], [768, 3]])('uses the required POI density at %i CSS pixels', (width, density) => {
    expect(createWheretooStandardConfig(width)).toMatchObject({
      lightPreset: 'night',
      theme: 'monochrome',
      font: 'Manrope',
      showPointOfInterestLabels: true,
      showRoadLabels: true,
      showPedestrianRoads: true,
      showPlaceLabels: true,
      densityPointOfInterestLabels: density,
      colorModePointOfInterestLabels: 'single',
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
    })
  })
})
