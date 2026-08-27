import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadConnectAndInitialize } = vi.hoisted(() => ({ loadConnectAndInitialize: vi.fn() }))

vi.mock('@stripe/connect-js', () => ({ loadConnectAndInitialize }))
vi.mock('@stripe/react-connect-js', () => ({
  ConnectComponentsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ConnectNotificationBanner: () => <p>Stripe notifications</p>,
  ConnectAccountOnboarding: ({ onExit }: { onExit: () => void }) => (
    <button onClick={onExit} type="button">Embedded onboarding</button>
  ),
  ConnectAccountManagement: () => <p>Embedded account management</p>,
}))
vi.mock('../../lib/env', () => ({ publicEnv: { stripePublishableKey: 'pk_test_public' } }))

import StripeConnectEmbedded from './StripeConnectEmbedded'

const initialSession = {
  clientSecret: 'first-account-session',
  status: { status: 'pending' as const, requirements_currently_due_count: 0, requirements_past_due_count: 0, last_status_code: null, last_synced_at: '2026-08-25T12:00:00.000Z' },
}

describe('StripeConnectEmbedded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadConnectAndInitialize.mockReturnValue({})
  })

  it('uses only the approved embedded components and refreshes Account Sessions when Connect asks again', async () => {
    const refreshAccountSession = vi.fn().mockResolvedValue({
      ...initialSession,
      clientSecret: 'refreshed-account-session',
    })
    const renderEmbedded = (mode: 'onboarding' | 'management') => (
      <StrictMode>
        <StripeConnectEmbedded
          initialSession={initialSession}
          mode={mode}
          onExit={vi.fn()}
          onLoadError={vi.fn()}
          refreshAccountSession={refreshAccountSession}
        />
      </StrictMode>
    )
    const { rerender } = render(renderEmbedded('onboarding'))

    expect(screen.getByText('Stripe notifications')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Embedded onboarding' })).toBeInTheDocument()
    expect(screen.queryByText(/payments|payouts|balance|analytics|refund/i)).not.toBeInTheDocument()

    const options = loadConnectAndInitialize.mock.calls[0]?.[0] as {
      fetchClientSecret: () => Promise<string>
      publishableKey: string
    }
    expect(options.publishableKey).toBe('pk_test_public')
    await expect(options.fetchClientSecret()).resolves.toBe('first-account-session')
    await expect(options.fetchClientSecret()).resolves.toBe('refreshed-account-session')
    expect(refreshAccountSession).toHaveBeenCalledOnce()

    rerender(renderEmbedded('management'))
    expect(screen.getByText('Embedded account management')).toBeInTheDocument()
    expect(loadConnectAndInitialize).toHaveBeenCalledOnce()
  })
})
