import { beforeEach, describe, expect, it, vi } from 'vitest'
const { rpc, getSession } = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc, auth: { getSession } } }))
import { saveSettingsProfile, settingsProfileInputSchema } from './settings.profile.api'
const input = { displayName: 'Night Assembly', bio: 'Events after dark.', expectedUpdatedAt: '2026-09-01T00:00:00Z' }
const row = { display_name: input.displayName, bio: input.bio, updated_at: '2026-09-12T00:00:00Z' }
const setHeader = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ data: { session: { user: { id: 'owner-a' }, access_token: 'synthetic-auth' } }, error: null })
  rpc.mockReturnValue({ setHeader })
  setHeader.mockResolvedValue({ data: [row], error: null })
})
describe('Settings profile contract', () => {
  it('sends only bounded settings fields/version with the captured authenticated session', async () => {
    await expect(saveSettingsProfile('owner-a', input)).resolves.toEqual({ displayName: row.display_name, bio: row.bio, updatedAt: row.updated_at })
    expect(rpc).toHaveBeenCalledWith('save_owned_organizer_settings', { p_display_name: input.displayName, p_bio: input.bio, p_expected_updated_at: input.expectedUpdatedAt })
    expect(setHeader).toHaveBeenCalledWith('Authorization', 'Bearer synthetic-auth')
  })
  it('surfaces an explicit conflict without raw database details', async () => {
    setHeader.mockResolvedValue({ data: null, error: { message: 'ORGANIZER_SETTINGS_CONFLICT', details: 'private data' } })
    await expect(saveSettingsProfile('owner-a', input)).rejects.toMatchObject({ code: 'conflict' })
  })
  it('rejects a changed identity before any save', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'owner-b' }, access_token: 'other' } }, error: null })
    await expect(saveSettingsProfile('owner-a', input)).rejects.toMatchObject({ code: 'session' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('checks the original identity lifetime after async session lookup', async () => {
    await expect(saveSettingsProfile('owner-a', input, () => false)).rejects.toMatchObject({ code: 'session' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('fails closed on extra fields and unbounded inputs', () => {
    expect(settingsProfileInputSchema.safeParse({ ...input, userId: 'someone' }).success).toBe(false)
    expect(settingsProfileInputSchema.safeParse({ ...input, bio: 'a'.repeat(501) }).success).toBe(false)
  })
  it('rejects an unsafe response instead of rendering hidden fields', async () => {
    setHeader.mockResolvedValue({ data: [{ ...row, login_email: 'private@example.invalid' }], error: null })
    await expect(saveSettingsProfile('owner-a', input)).rejects.toMatchObject({ code: 'unavailable' })
  })
})
