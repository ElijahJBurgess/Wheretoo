import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }))

vi.mock('../../features/auth/SessionProvider', () => ({ useSession }))

import { RequireSession } from './RequireSession'

function SignInProbe() {
  const location = useLocation()
  const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from
  const paymentEventId = (location.state as { paymentEventId?: string } | null)?.paymentEventId
  return <><p>sign-in:{from?.pathname}{from?.search}</p><p data-testid="payment-context">{paymentEventId ?? 'none'}</p></>
}

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/organizer/events?view=drafts']}>
      <Routes>
        <Route element={<RequireSession />}>
          <Route path="/organizer/events" element={<p>protected events</p>} />
        </Route>
        <Route path="/auth/sign-in" element={<SignInProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireSession', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders a deterministic loading state without protected content', () => {
    useSession.mockReturnValue({ status: 'loading', session: null, user: null })
    renderGuard()

    expect(screen.getByText('Checking your session')).toBeInTheDocument()
    expect(screen.queryByText('protected events')).not.toBeInTheDocument()
  })

  it('redirects anonymous users and preserves the attempted location', () => {
    useSession.mockReturnValue({ status: 'anonymous', session: null, user: null })
    renderGuard()

    expect(screen.getByText('sign-in:/organizer/events?view=drafts')).toBeInTheDocument()
    expect(screen.queryByText('protected events')).not.toBeInTheDocument()
  })

  it('renders the protected outlet only for an authenticated session', () => {
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'user-1' } })
    renderGuard()

    expect(screen.getByText('protected events')).toBeInTheDocument()
  })
})

const paymentId = '11111111-1111-4111-8111-111111111111'
it.each([
  [`/organizer/settings/payments?eventId=${paymentId}`, paymentId],
  [`/organizer/settings/payments?eventId=${paymentId}&redirect=evil#evil`, paymentId],
  [`/organizer/settings/payments?eventId=${paymentId}&eventId=${paymentId}`, 'none'],
  ['/organizer/settings/payments?eventId=invalid', 'none'],
  [`/organizer/events?eventId=${paymentId}`, 'none'],
])('projects only a single validated same-event Payments ID from %s', (path, expected) => {
  useSession.mockReturnValue({ status: 'anonymous', session: null, user: null })
  render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<RequireSession />}><Route path="*" element={<p>private</p>} /></Route><Route path="/auth/sign-in" element={<SignInProbe />} /></Routes></MemoryRouter>)
  expect(screen.getByTestId('payment-context')).toHaveTextContent(expected)
})
