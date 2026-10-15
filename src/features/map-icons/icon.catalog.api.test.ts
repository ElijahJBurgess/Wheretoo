import { beforeEach, expect, it, vi } from 'vitest'
import { flagDescriptor } from './icon.test-fixtures'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc } }))
import { getOwnedEventMapIcon, listSelectableMapIcons } from './icon.catalog.api'

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:56321') })
it('requests approved catalog pages and builds only canonical delivery URLs', async () => {
  rpc.mockResolvedValue({ data: { catalogRevision: 3, selectionEnabled: true, icons: [flagDescriptor] }, error: null })
  const page = await listSelectableMapIcons(null)
  expect(rpc).toHaveBeenCalledWith('list_selectable_map_icons', { p_limit: 50 })
  expect(page.icons[0]).toMatchObject({ versionId: flagDescriptor.versionId, name: 'Wheretoo Flag', url: `http://127.0.0.1:56321/storage/v1/object/public/map-icon-published/${flagDescriptor.runtimeObjectKey}` })
  expect(page.nextCursor).toBeNull()
})
it('honors selection disable even when the server still returns catalog entries', async () => {
  rpc.mockResolvedValue({ data: { catalogRevision: 4, selectionEnabled: false, icons: [flagDescriptor] }, error: null })
  expect((await listSelectableMapIcons(null)).icons).toEqual([])
})
it('isolates malformed artwork while preserving approved siblings', async () => {
  rpc.mockResolvedValue({ data: { catalogRevision: 4, selectionEnabled: true, icons: [{ ...flagDescriptor, runtimeObjectKey: 'https://bad.invalid/x' }, flagDescriptor] }, error: null })
  expect((await listSelectableMapIcons(null)).icons).toHaveLength(1)
})
it('propagates catalog failure for explicit retry instead of erasing selection', async () => {
  rpc.mockResolvedValue({ data: null, error: new Error('Offline') })
  await expect(listSelectableMapIcons(null)).rejects.toThrow('Offline')
})
it('reads a retained revoked choice as named but non-renderable', async () => {
  rpc.mockResolvedValue({ data: { versionId: flagDescriptor.versionId, name: 'Wheretoo Flag', state: 'revoked', descriptor: null }, error: null })
  expect(await getOwnedEventMapIcon('event-id')).toMatchObject({ name: 'Wheretoo Flag', state: 'revoked', descriptor: null })
  expect(rpc).toHaveBeenCalledWith('get_owned_event_map_icon', { p_event_id: 'event-id' })
})
