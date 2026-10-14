import { describe, expect, it } from 'vitest'
import { createMapOptions } from './mapbox.factory'

describe('createMapOptions', () => {
  const container = document.createElement('div')

  it.each([
    [false, 14.6, 25],
    [true, 14.8, 12],
  ])('uses the approved Oakland camera when mobile is %s', (mobile, zoom, pitch) => {
    expect(createMapOptions({ container, accessToken: 'pk.example', mobile })).toMatchObject({
      style: 'mapbox://styles/mapbox/standard',
      projection: 'mercator',
      center: [-122.263, 37.804],
      zoom,
      pitch,
      bearing: 0,
      minPitch: 0,
      maxPitch: 45,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    })
  })

  it('keeps an embedded map from trapping page scroll', () => {
    expect(createMapOptions({ container, accessToken: 'pk.example', mobile: true, cooperativeGestures: true })).toMatchObject({ cooperativeGestures: true })
  })

  it('enables native Standard buildings without installing a custom layer', () => {
    const options = createMapOptions({ container, accessToken: 'pk.example', mobile: false })
    expect(options.config).toMatchObject({ basemap: { show3dObjects: true, show3dBuildings: true } })
    expect(options).not.toHaveProperty('customLayer')
  })
})
