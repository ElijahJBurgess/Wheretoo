import { describe, expect, it } from 'vitest'
import { iconMetadataSchema, iconOffset } from './icon.schemas'

export const flagMetadata = {
  schemaVersion: 1, widthPx: 600, heightPx: 922, pixelRatio: 3,
  contactPx: [87, 922], anchor: 'bottom', selectedScale: 1,
  desktop: { minZoom: 14.5, maxZoom: 24, stops: [[14.6, .18], [14.8, .19], [16.25, .22]] },
  mobile: { minZoom: 14.5, maxZoom: 24, stops: [[14.6, .18], [14.8, .19], [16.25, .22]] },
  hit: { kind: 'legacy-css-circle', radius: 38, translation: [17, -34], minTargetDiameter: 44 },
  alignment: { pitch: 'viewport', rotation: 'viewport' }, collisionMode: 'always-visible', sdf: false,
}

describe('immutable PNG presentation contract', () => {
  it('derives the contact offset without stretching the approved flag', () => {
    expect(iconOffset(iconMetadataSchema.parse(flagMetadata))).toEqual([71, 0])
  })
  it.each([
    { url: 'https://example.com/icon.png' }, { widthPx: 1025 }, { pixelRatio: 0 },
    { contactPx: [601, 922] }, { contactPx: [87, -1] }, { selectedScale: 2 },
    { collisionMode: 'hide' }, { sdf: true }, { anchor: 'center' },
    { widthPx: NaN }, { heightPx: Infinity },
    { desktop: { ...flagMetadata.desktop, stops: [[15, .2], [14, .2]] } },
    { mobile: { ...flagMetadata.mobile, stops: [[14.6, 2], [16, 2]] } },
    { hit: { ...flagMetadata.hit, radius: 65 } },
    { hit: { ...flagMetadata.hit, css: 'color:red' } },
    { alignment: { pitch: 'map', rotation: 'viewport' } },
    { desktop: { ...flagMetadata.desktop, expression: ['zoom'] } },
  ])('rejects unsafe or inconsistent metadata %j', (change) => {
    expect(iconMetadataSchema.safeParse({ ...flagMetadata, ...change }).success).toBe(false)
  })
})
