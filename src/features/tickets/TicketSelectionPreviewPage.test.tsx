import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { TicketSelectionPreviewPage } from './TicketSelectionPreviewPage'

it('supports 2 GA + 1 VIP in the isolated preview using the real quantity contract', () => {
  render(<TicketSelectionPreviewPage />)
  fireEvent.change(screen.getByRole('spinbutton', { name: 'General Admission quantity' }), { target: { value: '2' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'VIP quantity' }), { target: { value: '1' } })
  expect(screen.getByRole('status')).toHaveTextContent('3 of 10 tickets selected')
  expect(screen.getByRole('button', { name: 'Get tickets' })).toBeEnabled()
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('spinbutton', { name: 'VIP quantity' }), { target: { value: '9' } })
  expect(screen.getByRole('button', { name: 'Get tickets' })).toBeDisabled()
})
