import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CheckoutState } from './CheckoutPage'

describe('CheckoutState', () => {
  it.each([
    ['Cancelling checkout', 'loading', 'status'],
    ['Loading checkout', 'loading', 'status'],
    ['Checkout could not load', 'error', 'alert'],
    ['This ticket is unavailable', 'empty', 'status'],
  ] as const)('gives %s exactly one h1, a %s state role, and a safe return control', (title, status, role) => {
    render(
      <CheckoutState
        action={<a href="/events/eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f">Return to event</a>}
        status={status}
        title={title}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole(role)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Return to event' })).toHaveAttribute('href', '/events/eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f')
  })
})
