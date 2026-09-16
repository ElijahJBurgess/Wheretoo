import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PreviewApp } from './PreviewApp'

vi.mock('qrcode.react', () => ({ QRCodeCanvas: () => <canvas aria-label="Admission QR code" /> }))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('lets a buyer traverse the isolated journey without payments or service requests', () => {
  const fetch = vi.fn(() => { throw new Error('No services in buyer previews') })
  vi.stubGlobal('fetch', fetch)
  window.history.replaceState({}, '', '/preview/event-page')
  render(<PreviewApp />)
  fireEvent.click(screen.getByRole('link', { name: 'Get tickets' }))
  expect(window.location.pathname).toBe('/preview/ticket-selection')
  fireEvent.change(screen.getByRole('spinbutton', { name: 'General Admission quantity' }), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Get tickets' }))
  expect(window.location.pathname).toBe('/preview/checkout')
  expect(screen.getByText('2 tickets')).toBeInTheDocument()
  expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Preview confirmation' }))
  expect(window.location.pathname).toBe('/preview/confirmation')
  fireEvent.click(screen.getByRole('link', { name: 'View tickets' }))
  expect(window.location.pathname).toBe('/preview/ticket-wallet')
  fireEvent.click(screen.getByRole('link', { name: 'View first ticket' }))
  expect(window.location.pathname).toBe('/preview/qr-ticket')
  expect(screen.queryByRole('button', { name: /wallet/i })).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['used-ticket', 'refunded-ticket', 'cancelled-ticket'])('renders %s without a QR credential or unsupported metadata', (slug) => {
  window.history.replaceState({}, '', `/preview/${slug}`)
  const view = render(<PreviewApp />)
  expect(screen.queryByText('Screen not found')).not.toBeInTheDocument()
  expect(view.container.querySelector('[data-inactive-ticket]')).not.toBeNull()
  expect(view.container.querySelector('canvas')).toBeNull()
  expect(view.container.innerHTML).not.toMatch(/wta1_|admissionCredential|credential_hash/)
  expect(screen.queryByText(/tickets were sent|apple wallet|good company/i)).not.toBeInTheDocument()
})

it('recovers an out-of-range preview selector using the current collection', () => {
  window.history.replaceState({}, '', '/preview/qr-ticket?ticket=5')
  render(<PreviewApp />)
  expect(screen.getByRole('status')).toHaveTextContent('Ticket 1 of 3')
})
