import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ index: vi.fn(), member: vi.fn() }))
vi.mock('./delivery.public-api', () => ({ publicTicketDeliveryApi: api }))
vi.mock('qrcode.react', () => ({ QRCodeCanvas: () => <canvas aria-label='Admission QR code' /> }))
import { TicketEmailAccessPage } from './TicketEmailAccessPage'
import { captureTicketAccess } from './delivery.session'
const token = 'em1_' + 'A'.repeat(43)
const id = '11111111-1111-4111-8111-111111111111'
const usedId = '22222222-2222-4222-8222-222222222222'
const expiresAt = '2027-01-01T12:00:00Z'
const row = (selector: number) => ({ selector, sourceKind: 'free_registration', eventName: 'Night', startsAt: '2027-01-01T12:00:00Z', quantity: 2, createdAt: '2026-09-11T12:00:00Z' })
const baseTicket = { eventId: id, eventName: 'Night', startsAt: '2027-01-01T12:00:00Z', endsAt: '2027-01-02T12:00:00Z', venueName: 'Hall', admissionLabel: 'GA', attendeeLabel: 'Alex', timezone: 'UTC', totalInCollection: 2 }
const collection = { registrationId: id, registrationStatus: 'confirmed', collectionLabel: 'Your tickets', eventId: id, tickets: [{ ...baseTicket, selector: id, position: 1, status: 'valid', admissionCredential: 'wta1_' + 'A'.repeat(43) }, { ...baseTicket, selector: usedId, position: 2, status: 'used', admissionCredential: null, usedAt: '2026-09-11T13:00:00Z' }] }
function show(path = '/ticket-access') { const router = createMemoryRouter([{ path: '/ticket-access', element: <TicketEmailAccessPage /> }], { initialEntries: [path] }); return { ...render(<RouterProvider router={router} />), router } }
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); history.replaceState(null, '', '/ticket-access#' + token); captureTicketAccess()
  api.index.mockResolvedValue({ kind: 'index', expiresAt, total: 21, page: 0, nextPage: 1, collections: Array.from({ length: 20 }, (_, i) => row(i + 1)) })
  api.member.mockResolvedValue({ kind: 'ready', collection, expiresAt })
})
it('pages 20 collections and selects only a member in the current grant index without putting its bearer in URLs', async () => {
  const { router } = show()
  expect(await screen.findAllByText('Night')).toHaveLength(20)
  api.index.mockResolvedValue({ kind: 'index', expiresAt, total: 21, page: 1, nextPage: null, collections: [row(21)] })
  fireEvent.click(screen.getByRole('link', { name: 'Next collections' }))
  await waitFor(() => expect(screen.getAllByText('Night')).toHaveLength(1))
  expect(api.index).toHaveBeenLastCalledWith(token, 1, expect.anything())
  fireEvent.click(screen.getByRole('link', { name: /Night/ }))
  await screen.findByRole('heading', { name: 'Your tickets' })
  expect(api.member).toHaveBeenCalledWith(token, 21, 'free_registration', expect.anything())
  expect(JSON.stringify(router.state.location)).not.toContain(token)
  expect(screen.getByRole('link', { name: 'Back to collections' })).toHaveAttribute('href', '/ticket-access?page=1')
})
it('opens one source directly through existing one-QR navigation and preserves Used history', async () => {
  api.index.mockResolvedValue({ kind: 'index', expiresAt, total: 1, page: 0, nextPage: null, collections: [row(1)] })
  const { router } = show()
  await screen.findByRole('heading', { name: 'Your tickets' })
  const links = screen.getAllByRole('link').filter(link => link.getAttribute('href')?.includes('ticket='))
  fireEvent.click(links[0]!)
  await screen.findByLabelText('Admission QR code')
  expect(screen.getAllByLabelText('Admission QR code')).toHaveLength(1)
  expect(router.state.location.search).toContain('member=1')
  expect(router.state.location.pathname).toBe('/ticket-access')
  fireEvent.click(screen.getByRole('button', { name: /Next ticket/ }))
  expect(await screen.findByText(/Checked in/)).toBeVisible()
  expect(screen.queryByLabelText('Admission QR code')).not.toBeInTheDocument()
})
it('invalid or expired grants show the same safe recovery route', async () => {
  history.replaceState(null, '', '/ticket-access#invalid'); captureTicketAccess()
  show()
  expect(await screen.findByRole('heading', { name: 'Ticket link unavailable' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Find your tickets' })).toHaveAttribute('href', '/tickets/recover')
  expect(api.index).not.toHaveBeenCalled()
})
it('does not display a collection that disagrees with the selected index entry', async () => {
  api.index.mockResolvedValue({ kind: 'index', expiresAt, total: 1, page: 0, nextPage: null, collections: [row(1)] })
  api.member.mockResolvedValue({ kind: 'ready', expiresAt, collection: { ...collection, tickets: collection.tickets.map(t => ({ ...t, eventName: 'Other event' })) } })
  show()
  expect(await screen.findByText('Tickets unavailable')).toBeVisible()
  expect(screen.queryByText('Other event')).not.toBeInTheDocument()
})
it.each(['rate_limited', 'network'])('retries an index %s failure with the same grant and selectors without extending expiry', async kind => {
  const failure = kind === 'rate_limited' ? Object.assign(new Error('limit'), { kind }) : new TypeError('network')
  api.index.mockRejectedValueOnce(failure).mockResolvedValueOnce({ kind: 'index', expiresAt, total: 21, page: 1, nextPage: null, collections: [row(21)] })
  const before = sessionStorage.getItem('wheretoo:ticket-email-access:v1')
  show('/ticket-access?page=1')
  await screen.findByRole('button', { name: 'Try this link again' })
  expect(sessionStorage.getItem('wheretoo:ticket-email-access:v1')).toBe(before)
  fireEvent.click(screen.getByRole('button', { name: 'Try this link again' }))
  expect(await screen.findByText('Night')).toBeVisible()
  expect(api.index).toHaveBeenCalledTimes(2)
  for (const call of api.index.mock.calls) { expect(call[0]).toBe(token); expect(call[1]).toBe(1) }
  expect(JSON.parse(sessionStorage.getItem('wheretoo:ticket-email-access:v1')!).expiresAt).toBeLessThanOrEqual(JSON.parse(before!).expiresAt)
})
it.each(['rate_limited', 'network'])('retries a member %s failure through the same grant and ticket selector', async kind => {
  const failure = kind === 'rate_limited' ? Object.assign(new Error('limit'), { kind }) : new TypeError('network')
  api.index.mockResolvedValue({ kind: 'index', expiresAt, total: 1, page: 0, nextPage: null, collections: [row(1)] })
  api.member.mockRejectedValueOnce(failure).mockResolvedValueOnce({ kind: 'ready', expiresAt, collection })
  const { router } = show('/ticket-access?member=1&ticket=' + id)
  await screen.findByRole('button', { name: 'Try this link again' })
  expect(screen.queryByLabelText('Admission QR code')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try this link again' }))
  expect(await screen.findByLabelText('Admission QR code')).toBeVisible()
  expect(api.member).toHaveBeenCalledTimes(2)
  for (const call of api.member.mock.calls) { expect(call[0]).toBe(token); expect(call[1]).toBe(1) }
  expect(router.state.location.search).toBe('?member=1&ticket=' + id)
})
it('keeps definitive unavailable grants on the indistinguishable invalid-link screen', async () => {
  api.index.mockRejectedValue(Object.assign(new Error('not found'), { kind: 'unavailable' }))
  show()
  expect(await screen.findByRole('heading', { name: 'Ticket link unavailable' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Try this link again' })).not.toBeInTheDocument()
})
it('distinguishes identical same-minute purchases visibly and opens their respective collections', async () => {
  api.index.mockResolvedValue({ kind: 'index', expiresAt, total: 2, page: 0, nextPage: null, collections: [row(1), row(2)].map(value => ({ ...value, sourceKind: 'paid_order' })) })
  const { router } = show()
  const first = await screen.findByRole('link', { name: /Collection 1.*Night/ })
  const second = screen.getByRole('link', { name: /Collection 2.*Night/ })
  expect(first).toHaveTextContent('Collection 1')
  expect(second).toHaveTextContent('Collection 2')
  fireEvent.click(second)
  await screen.findByRole('heading', { name: 'Your tickets' })
  expect(api.member).toHaveBeenLastCalledWith(token, 2, 'paid_order', expect.anything())
  fireEvent.click(screen.getByRole('link', { name: 'Back to collections' }))
  fireEvent.click(await screen.findByRole('link', { name: /Collection 1.*Night/ }))
  await waitFor(() => expect(api.member).toHaveBeenLastCalledWith(token, 1, 'paid_order', expect.anything()))
  expect(router.state.location.search).toBe('?member=1')
})
