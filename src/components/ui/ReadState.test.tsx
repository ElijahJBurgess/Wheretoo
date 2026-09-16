import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReadState } from './ReadState'

afterEach(() => vi.restoreAllMocks())

describe('passive read connectivity', () => {
  it('explains a paused initial read without claiming service availability or retrying on reconnect', () => {
    let online = false
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    const retry = vi.fn()
    const { container } = render(<ReadState status="loading" title="Loading orders" skeleton="order-rows"
      action={<button onClick={retry}>Try again</button>} />)
    expect(screen.getByRole('heading')).toHaveTextContent('Waiting for a connection')
    expect(container.querySelector('.ui-state-skeleton')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'false')
    online = true
    act(() => window.dispatchEvent(new Event('online')))
    expect(screen.getByRole('heading')).toHaveTextContent('Loading orders')
    expect(retry).not.toHaveBeenCalled()
  })

  it('does not replace an authoritative empty result or error with browser connectivity inference', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { rerender } = render(<ReadState status="empty" title="No events yet" />)
    expect(screen.getByRole('heading')).toHaveTextContent('No events yet')
    rerender(<ReadState status="unavailable" title="Tickets unavailable" />)
    expect(screen.getByRole('heading')).toHaveTextContent('Tickets unavailable')
  })
})
