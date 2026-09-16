import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
const { status } = vi.hoisted(() => ({ status: vi.fn() }))
vi.mock('./delivery.public-api', () => ({ publicTicketDeliveryApi: { status } }))
import { TicketDeliveryNotice } from './TicketDeliveryNotice'
it('does an independent status read, keeps queued distinct and hides stale bearer responses', async () => {
  status.mockResolvedValue({ state: 'queued', observation: null })
  const view = render(<MemoryRouter><TicketDeliveryNotice collectionBearer='A' /></MemoryRouter>)
  expect(await screen.findByText('Ticket email queued')).toBeVisible()
  status.mockReturnValue(new Promise(() => {}))
  view.rerender(<MemoryRouter><TicketDeliveryNotice collectionBearer='B' /></MemoryRouter>)
  expect(screen.queryByText('Ticket email queued')).not.toBeInTheDocument()
})
it('malformed/unavailable reads never claim sent and preserve ticket recovery', async () => {
  status.mockRejectedValue(new Error('bad'))
  render(<MemoryRouter><TicketDeliveryNotice collectionBearer='A' /></MemoryRouter>)
  expect(await screen.findByText('Email status unavailable')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Find your tickets' })).toHaveAttribute('href', '/tickets/recover')
})
