// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { approvedPack, metadataForIcon, verifyPreparedIcon, iconRequestId, assertIconImportTarget } from './import-v1-pack'
import { iconOffset } from '../../src/features/map-icons/icon.schemas'

describe('approved V1 icon pack', () => {
  it('permits the exact approved staging origin only with its explicit project identity', () => {
    expect(() => assertIconImportTarget('https://oznjmliqnczotunksafx.supabase.co', 'oznjmliqnczotunksafx')).not.toThrow()
    expect(() => assertIconImportTarget('http://127.0.0.1:64321')).not.toThrow()
    expect(() => assertIconImportTarget('https://oznjmliqnczotunksafx.supabase.co')).toThrow()
  })
  it.each(['https://elsewhere.supabase.co', 'https://oznjmliqnczotunksafx.supabase.co/path',
    'https://oznjmliqnczotunksafx.supabase.co@evil.test', 'http://oznjmliqnczotunksafx.supabase.co'])('refuses a mismatched staging origin %s', url => {
    expect(() => assertIconImportTarget(url, 'oznjmliqnczotunksafx')).toThrow()
  })
  it('refuses an unapproved project even when the hostname is staging', () => {
    expect(() => assertIconImportTarget('https://oznjmliqnczotunksafx.supabase.co', 'another-project')).toThrow()
  })
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
