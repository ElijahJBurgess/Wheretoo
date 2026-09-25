import { beforeEach, expect, it, vi } from 'vitest'
const { rpc, getSession, setHeader } = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), setHeader: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc, auth: { getSession } } }))
import { saveProfile } from './profile.api'
const input = { displayName: 'Night Assembly', bio: '', websiteUrl: '', organizerType: '', baseCity: '' }
beforeEach(() => { vi.clearAllMocks(); getSession.mockResolvedValue({ data: { session: { user: { id: 'a' }, access_token: 'token-a' } } }); rpc.mockReturnValue({ setHeader }); setHeader.mockResolvedValue({ data: { updatedAt: '2026-09-24T00:00:00Z' }, error: null }) })
it('saves a draft without passing a handle or completion state', async () => {
  await expect(saveProfile('a', input, null, null, () => true)).resolves.toEqual({ updatedAt: '2026-09-24T00:00:00Z' })
  expect(rpc).toHaveBeenCalledWith('save_owned_organizer_setup', { p_profile: input, p_expected_updated_at: null, p_logo_id: null })
  expect(setHeader).toHaveBeenCalledWith('Authorization', 'Bearer token-a')
})
it('rejects a changed session before dispatch', async () => {
  await expect(saveProfile('a', input, null, null, () => false)).rejects.toThrow('session changed')
  expect(rpc).not.toHaveBeenCalled()
})
it('rejects a stale profile with recoverable conflict copy', async () => {
  setHeader.mockResolvedValue({ error: { message: 'ORGANIZER_SETTINGS_CONFLICT' } })
  await expect(saveProfile('a', input, null, null, () => true)).rejects.toThrow('changed elsewhere')
})
it('discards a save response after sign-out', async () => {
  let current = true
  setHeader.mockImplementation(async () => { current = false; return { data: { updatedAt: '2026-09-24T00:00:00Z' } } })
  await expect(saveProfile('a', input, null, null, () => current)).rejects.toThrow('session changed')
})
