import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const { initialize } = vi.hoisted(() => ({ initialize: vi.fn<(options: unknown) => object>(() => ({})) }))
vi.mock('@stripe/connect-js', () => { throw new Error('Eager Connect SDK entry must not be imported') })
vi.mock('@stripe/connect-js/pure', () => ({ loadConnectAndInitialize: initialize }))
vi.mock('@stripe/react-connect-js', () => ({
  ConnectComponentsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ConnectNotificationBanner: () => null,
  ConnectAccountOnboarding: () => <p>Secure onboarding ready</p>,
  ConnectAccountManagement: () => <p>Secure management ready</p>,
}))
vi.mock('../../lib/env', () => ({ publicEnv: { stripePublishableKey: 'pk_test_public' } }))
import { ConnectEmbeddedPanel } from './ConnectEmbeddedPanel'

const url = 'https://connect-js.stripe.com/v1.0/connect.js'
const getScript = () => document.querySelector<HTMLScriptElement>(`script[src="${url}"]`)!
const session = (secret: string) => ({ clientSecret: secret, status: { status: 'ready' as const, requirements_currently_due_count: 0, requirements_past_due_count: 0, last_status_code: null, last_synced_at: '2026-08-25T12:00:00.000Z' } })
const props = () => ({ initialSession: session('original'), mode: 'onboarding' as const, onExit: vi.fn(), onLoadError: vi.fn(), refreshAccountSession: vi.fn() })
async function loaded() {
  vi.stubGlobal('StripeConnect', { init: vi.fn() })
  await act(async () => { getScript().dispatchEvent(new Event('load')) })
}

describe('external Connect script panel recovery', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(async () => {
    cleanup()
    await act(async () => { getScript()?.dispatchEvent(new Event('error')) })
    getScript()?.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  })

  it('catches exact external script failure inside the panel, retains exit, and initializes only after successful retry', async () => {
    const user = userEvent.setup(); const values = props(); render(<ConnectEmbeddedPanel {...values} />)
    expect(screen.getByText('Loading secure payment setup')).toBeInTheDocument()
    expect(initialize).not.toHaveBeenCalled()
    await act(async () => { getScript().dispatchEvent(new Event('error')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
    await user.click(screen.getByRole('button', { name: 'Finish setup later' }))
    expect(values.onExit).toHaveBeenCalledOnce(); expect(initialize).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Try again' })); await loaded()
    expect(await screen.findByText('Secure onboarding ready')).toBeInTheDocument()
    expect(initialize).toHaveBeenCalledOnce()
    expect(values.refreshAccountSession).not.toHaveBeenCalled()
  })

  it('does not initialize a disposed panel after the script finishes late', async () => {
    const values = props(); const view = render(<ConnectEmbeddedPanel {...values} />)
    expect(initialize).not.toHaveBeenCalled(); view.unmount(); await loaded()
    expect(initialize).not.toHaveBeenCalled(); expect(values.onLoadError).not.toHaveBeenCalled()
    expect(values.refreshAccountSession).not.toHaveBeenCalled()
  })

  it('resolves the shared resource only into the current identity lifetime', async () => {
    const old = props(); const current = { ...props(), initialSession: session('replacement') }
    const view = render(<ConnectEmbeddedPanel key="identity-old" {...old} />)
    const pending = getScript()
    view.rerender(<ConnectEmbeddedPanel key="identity-current" {...current} />)
    expect(getScript()).toBe(pending); await loaded()
    expect(await screen.findByText('Secure onboarding ready')).toBeInTheDocument()
    expect(initialize).toHaveBeenCalledOnce()
    const options = initialize.mock.calls[0]?.[0] as unknown as { fetchClientSecret: () => Promise<string> }
    await expect(options.fetchClientSecret()).resolves.toBe('replacement')
    expect(old.refreshAccountSession).not.toHaveBeenCalled(); expect(old.onLoadError).not.toHaveBeenCalled()
  })
})
