import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AsyncState } from './AsyncState'

describe('shared asynchronous presentation', () => {
  it('keeps actions under parent control and exposes the chosen heading level', () => {
    const retry = vi.fn()
    const leave = vi.fn()
    render(<AsyncState status="unavailable" headingAs="h1" title="Tickets unavailable"
      action={<button onClick={retry}>Try again</button>}
      secondaryAction={<button onClick={leave}>Go back</button>} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tickets unavailable')
    expect(retry).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(leave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
    expect(leave).toHaveBeenCalledTimes(1)
  })

  it('removes busy content when loading resolves and hides decorative skeletons from assistive technology', () => {
    const { container, rerender } = render(<AsyncState status="loading" skeleton="order-rows" title="Loading orders" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('.ui-state-skeleton')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByText(/\$|0 tickets|paid/i)).not.toBeInTheDocument()
    rerender(<AsyncState status="empty" title="No orders yet" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'false')
    expect(container.querySelector('.ui-state-skeleton')).not.toBeInTheDocument()
  })
})
