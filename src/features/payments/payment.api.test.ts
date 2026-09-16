import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke, getSession } = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }))

vi.mock('../../lib/supabase/client', () => ({ supabase: { functions: { invoke }, auth: { getSession } } }))

import { createConnectAccountSession, getConnectStatus, getExpressLoginUrl } from './payment.api'

const status = {
  status: 'action_required' as const,
  requirements_currently_due_count: 1,
  requirements_past_due_count: 0,
  last_status_code: 'requirements_due',
  last_synced_at: '2026-08-25T12:00:00.000Z',
}

describe('payment API', () => {
  beforeEach(() => vi.resetAllMocks())

  it('binds the captured owner JWT explicitly and rejects a later identity before returning', async () => {
    const token = crypto.randomUUID()
    getSession.mockResolvedValue({ data: { session: { user: { id: 'a' }, access_token: token } }, error: null })
    let active = true
    invoke.mockImplementationOnce(async () => { active = false; return { data: { client_secret: crypto.randomUUID(), connect_status: status }, error: null } })
    await expect(createConnectAccountSession('a', () => active)).rejects.toThrow('Payment setup could not be started')
    expect(invoke).toHaveBeenCalledWith('stripe-connect-session', { body: {}, method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  })
  it('does not invoke the provider if owner changed while looking up the session', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'b' }, access_token: crypto.randomUUID() } }, error: null })
    await expect(getExpressLoginUrl('a', () => true)).rejects.toThrow('Stripe Express could not be opened')
    expect(invoke).not.toHaveBeenCalled()
  })
  it('rejects a matching owner session from a superseded lifetime before invoking', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'a' }, access_token: crypto.randomUUID() } }, error: null })
    await expect(getConnectStatus('a', () => false)).rejects.toThrow('Payment setup could not be loaded')
    expect(invoke).not.toHaveBeenCalled()
  })

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
