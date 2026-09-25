import { beforeEach, expect, it, vi } from 'vitest'
const { rpc, getSession, setHeader } = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), setHeader: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc, auth: { getSession } } }))
import { readIdentity, confirmIdentity } from './storefront.identity.api'
beforeEach(() => { vi.clearAllMocks(); getSession.mockResolvedValue({ data: { session: { user: { id: 'a' }, access_token: 'token-a' } } }); rpc.mockReturnValue({ setHeader }); setHeader.mockResolvedValue({ data: { handle: 'night-club', confirmedAt: '2026-09-24' }, error: null }) })
it('identifies the missing deployment contract instead of disguising it as an empty profile', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
  await expect(readIdentity()).rejects.toThrow('not available in this environment')
})
it('claims without a logo using the existing authoritative contract', async () => {
  await confirmIdentity('night-club', null, 'a', () => true)
  expect(rpc).toHaveBeenCalledWith('confirm_owned_storefront_handle', { p_handle: 'night-club', p_logo_id: null })
  expect(setHeader).toHaveBeenCalledWith('Authorization', 'Bearer token-a')
})
it('does not claim after identity changes during token lookup', async () => {
  await expect(confirmIdentity('night-club', null, 'a', () => false)).rejects.toThrow('session changed')
  expect(rpc).not.toHaveBeenCalled()
})
