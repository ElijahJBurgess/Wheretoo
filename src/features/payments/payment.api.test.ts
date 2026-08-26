import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../lib/supabase/client', () => ({ supabase: { functions: { invoke } } }))

import { createConnectAccountSession, getConnectStatus, getExpressLoginUrl } from './payment.api'

const status = {
  status: 'action_required' as const,
  requirements_currently_due_count: 1,
  requirements_past_due_count: 0,
  last_status_code: 'requirements_due',
  last_synced_at: '2026-08-25T12:00:00.000Z',
}

describe('payment API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads the safe Connect status through the authenticated status function', async () => {
    invoke.mockResolvedValue({ data: status, error: null })

    await expect(getConnectStatus()).resolves.toEqual(status)

    expect(invoke).toHaveBeenCalledWith('stripe-connect-status', { body: {}, method: 'POST' })
  })

  it('creates an Account Session only through the authenticated session function', async () => {
    invoke.mockResolvedValue({
      data: { client_secret: 'session-secret', connect_status: status },
      error: null,
    })

    await expect(createConnectAccountSession()).resolves.toEqual({
      clientSecret: 'session-secret',
      status,
    })

    expect(invoke).toHaveBeenCalledWith('stripe-connect-session', { body: {}, method: 'POST' })
  })

  it('opens Express only through the authenticated owner-scoped function', async () => {
    invoke.mockResolvedValue({ data: { url: 'https://connect.stripe.com/express/login' }, error: null })

    await expect(getExpressLoginUrl()).resolves.toBe('https://connect.stripe.com/express/login')

    expect(invoke).toHaveBeenCalledWith('stripe-express-login', { body: {}, method: 'POST' })
  })

  it('does not expose a server error or accept an unsafe response shape', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('raw restricted Stripe error') })

    await expect(getConnectStatus()).rejects.toThrow('Payment setup could not be loaded')
  })
})
