import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { BuyerHeader } from './BuyerPrimitives'

it('preserves the buyer wordmark and supplied exit without advertising unactivated recovery', () => {
  render(<BuyerHeader back={<a href="/events/example">Return to event</a>} />)
  expect(screen.getByText('wheretoo')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Return to event' })).toHaveAttribute('href', '/events/example')
  expect(screen.queryByRole('link', { name: 'Find tickets' })).not.toBeInTheDocument()
})
