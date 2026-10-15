import { expect, it, vi } from 'vitest'
const { resetPasswordForEmail } = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { auth: { resetPasswordForEmail } } }))
import { requestPasswordReset } from './admin.api'
it('uses Supabase recovery with a fixed same-site reset destination', async () => {
  resetPasswordForEmail.mockResolvedValue({ error: null })
  await requestPasswordReset(' founder@example.test ')
  expect(resetPasswordForEmail).toHaveBeenCalledWith('founder@example.test', { redirectTo: `${window.location.origin}/admin/reset-password` })
})
it('sanitizes provider errors and never returns recovery links', async () => {
  resetPasswordForEmail.mockResolvedValue({ error: { message: 'secret provider details' } })
  await expect(requestPasswordReset('founder@example.test')).rejects.toThrow('We could not send the reset email. Please try again later.')
})
