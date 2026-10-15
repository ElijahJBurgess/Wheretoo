// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { approvedPack, metadataForIcon, verifyPreparedIcon, iconRequestId } from './import-v1-pack'
import { iconOffset } from '../../src/features/map-icons/icon.schemas'

describe('approved V1 icon pack', () => {
  it('anchors each artwork at its supplied ground contact with a bounded 3x display', () => {
    expect(approvedPack.icons).toHaveLength(9)
    for (const icon of approvedPack.icons) {
      const metadata = metadataForIcon(icon)
      expect(metadata.pixelRatio).toBe(3)
      expect(metadata.contactPx).toEqual(icon.ground_contact_point)
      const [x, y] = iconOffset(metadata)
      expect(x * 3 + icon.ground_contact_point[0]).toBeCloseTo(icon.width / 2)
      expect(y * 3 + icon.ground_contact_point[1]).toBeCloseTo(icon.height)
      for (const profile of [metadata.desktop, metadata.mobile]) {
        for (const [, scale] of profile.stops) {
          expect(Math.max(icon.width, icon.height) / 3 * scale * metadata.selectedScale).toBeLessThanOrEqual(96)
        }
      }
    }
  })
  it('refuses modified source or runtime bytes before decoding or uploading', () => {
    expect(() => verifyPreparedIcon(approvedPack.icons[0], Buffer.from('changed'), Buffer.from('changed'))).toThrow(/hash/i)
  })
  it('gives each icon a stable separate retry identity', () => {
    const ids = approvedPack.icons.map(iconRequestId)
    expect(new Set(ids).size).toBe(9)
    expect(approvedPack.icons.map(iconRequestId)).toEqual(ids)
    for (const id of ids) expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
  })
})
