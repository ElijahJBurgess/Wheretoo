import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
vi.mock('./auth.api', () => ({ signInOrganizer: vi.fn().mockResolvedValue({}) }))
import { SignInPage } from './SignInPage'

const eventId = '11111111-1111-4111-8111-111111111111'
const itemId = '22222222-2222-4222-8222-222222222222'
const ticketId = '33333333-3333-4333-8333-333333333333'
const fallback = '/organizer/events'
const supported = [
  '/organizer/setup', '/organizer/events', '/organizer/events/new',
  ...['', '/account', '/profile', '/payments', '/help', '/actions'].map(suffix => `/organizer/settings${suffix}`),
  ...['', '/edit', '/preview', '/changes', '/cancellation', '/tickets', '/dashboard', '/orders', `/orders/${itemId}`,
    '/registrations', `/registrations/${itemId}`, '/check-in', '/check-in/scan', '/check-in/find', `/check-in/find/${itemId}/${ticketId}`, `/check-in/find/registrations/${itemId}/${ticketId}`,
  ].map(suffix => `/organizer/events/${eventId}${suffix}`),
]
function Destination() {
  const location = useLocation()
  return <p data-testid="destination">{location.pathname}{location.search}{location.hash}</p>
}
async function signInFrom(from: unknown, extra: object = {}) {
  render(<MemoryRouter initialEntries={[{ pathname: '/auth/sign-in', state: { from, ...extra } }]}><Routes>
    <Route path="/auth/sign-in" element={<SignInPage />} /><Route path="*" element={<Destination />} />
  </Routes></MemoryRouter>)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'local@example.invalid')
  await user.type(screen.getByLabelText('Password'), 'synthetic-password')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  return (await screen.findByTestId('destination')).textContent
}
it.each(supported)('restores the guarded organizer path %s without query or fragment', async pathname => {
  expect(await signInFrom({ pathname, search: '?untrusted=value', hash: '#untrusted' })).toBe(pathname)
})
it.each([
  `evil/organizer/events/${eventId}/edit`, '/organizer/events/11111111-1111-1111-1111-111111111111/edit',
  'https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/organizer/events/../settings',
  '/organizer/events/%2e%2e/settings', '/ticket-access', '/moderation', '/organizer/settings/unknown',
  `/organizer/events/${eventId}/orders/not-a-uuid`, `/organizer/events/${eventId}/check-in/find/${itemId}`,
  `/organizer/events/${eventId}/registrations/${itemId}/extra`, '/organizer/events/not-a-uuid/edit',
  `/organizer/events/${eventId}/edit?redirect=evil`, `/organizer/events/${eventId}/edit#evil`,
  `/organizer/events/${eventId}/edit/`, `/organizer/events/${eventId}/check-in/find/${itemId}/%2f`, `/organizer/events/${eventId}/check-in/find/registrations/${itemId}/invalid`,
])('rejects unsupported or malformed destination %s', async pathname => {
  expect(await signInFrom({ pathname })).toBe(fallback)
})
it('restores only the typed same-event Payments context', async () => {
  expect(await signInFrom({ pathname: '/organizer/settings/payments', search: '?eventId=other&redirect=evil', hash: '#evil' }, { paymentEventId: eventId }))
    .toBe(`/organizer/settings/payments?eventId=${eventId}`)
})
it.each(['not-a-uuid', `${eventId}&redirect=evil`, null])('drops invalid Payments context %s', async paymentEventId => {
  expect(await signInFrom({ pathname: '/organizer/settings/payments' }, { paymentEventId })).toBe('/organizer/settings/payments')
})
it('does not attach Payments context to another route', async () => {
  expect(await signInFrom({ pathname: '/organizer/settings/account' }, { paymentEventId: eventId })).toBe('/organizer/settings/account')
})
