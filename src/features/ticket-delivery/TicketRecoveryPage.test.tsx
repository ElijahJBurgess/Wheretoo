import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const { recover } = vi.hoisted(() => ({ recover: vi.fn() }))
vi.mock('./delivery.public-api', () => ({ publicTicketDeliveryApi: { recover } }))
import { TicketRecoveryPage } from './TicketRecoveryPage'
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear() })
function show() { return render(<MemoryRouter><TicketRecoveryPage /></MemoryRouter>) }
it('uses the same neutral acknowledgement for any valid email', async () => {
  recover.mockResolvedValue({ kind: 'requested' })
  show()
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'Unknown@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send me my tickets' }))
  expect(await screen.findByText(/If eligible tickets match that email/)).toBeVisible()
  expect(screen.queryByText(/Tickets sent|No tickets found/)).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Contact support' })).not.toBeInTheDocument()
})
it('keeps request identity across uncertain retry and a component remount', async () => {
  recover.mockRejectedValue(new Error('lost'))
  const view = show()
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'Alex@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send me my tickets' }))
  await screen.findByRole('alert')
  const id = recover.mock.calls[0]![1]
  view.unmount(); show()
  expect(screen.getByLabelText('Email address')).toHaveValue('alex@example.com')
  recover.mockResolvedValue({ kind: 'requested' })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })))
  expect(recover.mock.calls[1]![1]).toBe(id)
})
it.each(['alex!guest@example.com', "alex.!#$%&'*+/=?^_`{|}~-guest@example.com", 'alex.first+night@example.com'])('recovers canonical punctuation through the form for %s', async email => {
  recover.mockResolvedValue({ kind: 'requested' })
  show()
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: ' ' + email.toUpperCase() + ' ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send me my tickets' }))
  expect(await screen.findByText(/If eligible tickets match that email/)).toBeVisible()
  expect(recover).toHaveBeenCalledWith(email, expect.any(String), expect.anything())
})
