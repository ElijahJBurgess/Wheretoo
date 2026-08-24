import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }))

vi.mock('../../features/auth/SessionProvider', () => ({ useSession }))

import { RequireSession } from './RequireSession'

function SignInProbe() {
  const location = useLocation()
  const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from
  return <p>sign-in:{from?.pathname}{from?.search}</p>
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
