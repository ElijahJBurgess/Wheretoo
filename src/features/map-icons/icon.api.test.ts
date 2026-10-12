import { describe, expect, it, vi } from 'vitest'
import { parseIconResponse, resolveMapIcons } from './icon.api'
import { flagDescriptor } from './icon.test-fixtures'

describe('public icon resolution', () => {
  it('honors a global rendering shutdown observed in a later batch', async () => {
    const ids = [flagDescriptor.versionId, ...Array.from({ length: 64 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)]
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { catalogRevision: 1, renderingEnabled: true, versions: [flagDescriptor] }, error: null })
      .mockResolvedValueOnce({ data: { catalogRevision: 2, renderingEnabled: false, versions: [] }, error: null })
    expect(await resolveMapIcons(ids, rpc, 'https://project.supabase.co')).toEqual([])
  })
  it('isolates unsupported siblings and refuses arbitrary asset paths', () => {
    const result = parseIconResponse({ catalogRevision: 1, renderingEnabled: true, versions: [
      flagDescriptor, { ...flagDescriptor, runtimeObjectKey: 'https://evil.test/a.png' },
    ] }, [flagDescriptor.versionId], 'https://project.supabase.co')
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe(`https://project.supabase.co/storage/v1/object/public/map-icon-published/${flagDescriptor.runtimeObjectKey}`)
    expect(parseIconResponse({ catalogRevision: 1, renderingEnabled: false, versions: [flagDescriptor] }, [flagDescriptor.versionId], 'https://project.supabase.co')).toEqual([])
  })
  it('rejects noncanonical keys, unknown metadata and unrequested descriptors independently', () => {
    for (const change of [{ runtimeObjectKey: '../x' }, { metadata: { ...flagDescriptor.metadata, schemaVersion: 2 } }, { url: 'https://evil.test' }]) {
      expect(parseIconResponse({ catalogRevision: 1, renderingEnabled: true, versions: [{ ...flagDescriptor, ...change }] }, [flagDescriptor.versionId], 'https://project.supabase.co')).toEqual([])
    }
    expect(parseIconResponse({ catalogRevision: 1, renderingEnabled: true, versions: [flagDescriptor] }, [], 'https://project.supabase.co')).toEqual([])
  })
  it('deduplicates and batches UUIDs with at most 64 IDs per RPC', async () => {
    const ids = Array.from({ length: 65 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const rpc = vi.fn(async () => ({ data: { catalogRevision: 1, renderingEnabled: true, versions: [] }, error: null }))
    await resolveMapIcons([...ids, ...ids, 'invalid'], rpc, 'https://project.supabase.co')
    expect(rpc.mock.calls).toHaveLength(2)
    expect(rpc).toHaveBeenNthCalledWith(1, 'get_public_map_icon_versions', { p_ids: ids.slice(0, 64) })
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_public_map_icon_versions', { p_ids: ids.slice(64) })
  })
})
