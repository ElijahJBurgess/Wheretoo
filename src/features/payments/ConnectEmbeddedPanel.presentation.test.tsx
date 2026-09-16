import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConnectEmbeddedPanel } from './ConnectEmbeddedPanel'

const session = {
  clientSecret: 'account-session-secret',
  status: {
    status: 'ready' as const,
    requirements_currently_due_count: 0,
    requirements_past_due_count: 0,
    last_status_code: null,
    last_synced_at: '2026-08-25T12:00:00.000Z',
  },
}

describe('ConnectEmbeddedPanel', () => {
  it('retries a rejected lazy Connect chunk without leaving the organizer on a permanent error', async () => {
    const user = userEvent.setup()
    const expectedConsoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let chunkIsAvailable = false
    const loadEmbedded = vi.fn(() => (
      chunkIsAvailable
        ? Promise.resolve({ default: () => <p>Embedded setup loaded</p> })
        : Promise.reject(new Error('chunk unavailable'))
    ))

    try {
      render(
        <ConnectEmbeddedPanel
          initialSession={session}
          loadEmbedded={loadEmbedded}
          mode="onboarding"
          onExit={vi.fn()}
          onLoadError={vi.fn()}
          refreshAccountSession={vi.fn()}
        />,
      )

      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
      chunkIsAvailable = true
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByText('Embedded setup loaded')).toBeInTheDocument()
      expect(loadEmbedded.mock.calls.length).toBeGreaterThanOrEqual(2)
    } finally {
      expectedConsoleError.mockRestore()
    }
  })

  it('recovers from an embedded initialization exception and allows postponing setup', async () => {
    const user = userEvent.setup()
    const expectedConsoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let initializationFails = true
    function Embedded() {
      if (initializationFails) throw new Error('Initialization failed')
      return <p>Secure Stripe component</p>
    }
    const onExit = vi.fn()
    try {
      render(<ConnectEmbeddedPanel initialSession={session} mode="onboarding" onExit={onExit} onLoadError={vi.fn()} refreshAccountSession={vi.fn()} loadEmbedded={() => Promise.resolve({ default: Embedded })} />)
      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
      initializationFails = false
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByText('Secure Stripe component')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Finish setup later' }))
      expect(onExit).toHaveBeenCalledOnce()
    } finally { expectedConsoleError.mockRestore() }
  })

  it('provides an explicit exit from account management so the payment page can recover focus', async () => {
    const user = userEvent.setup()
    const onExit = vi.fn()
    const loadEmbedded = vi.fn().mockResolvedValue({ default: () => <p>Embedded management loaded</p> })
    render(
      <ConnectEmbeddedPanel
        initialSession={session}
        loadEmbedded={loadEmbedded}
        mode="management"
        onExit={onExit}
        onLoadError={vi.fn()}
        refreshAccountSession={vi.fn()}
      />,
    )

    expect(await screen.findByText('Embedded management loaded')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done managing payments' }))
    expect(onExit).toHaveBeenCalledOnce()
  })
})

