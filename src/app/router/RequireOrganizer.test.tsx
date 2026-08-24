import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Organizer } from '../../features/organizers/organizer.api'

const { refetch, useOrganizer, useSession } = vi.hoisted(() => ({
  refetch: vi.fn(),
  useOrganizer: vi.fn(),
  useSession: vi.fn(),
}))

vi.mock('../../features/auth/SessionProvider', () => ({ useSession }))
vi.mock('../../features/organizers/organizer.queries', () => ({ useOrganizer }))

import { RequireOrganizer } from './RequireOrganizer'

const completeOrganizer: Organizer = {
  id: 'user-1',
  display_name: 'Bay City Arts',
  organizer_type: null,
  bio: null,
  website_url: null,
  base_city: 'San Francisco',
  country_code: 'US',
  onboarding_completed_at: '2026-08-24T12:00:00.000Z',
  created_at: '2026-08-24T12:00:00.000Z',
  updated_at: '2026-08-24T12:00:00.000Z',
}

function renderRoute(initialEntry = '/organizer/events') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/organizer/setup" element={<p>organizer setup</p>} />
        <Route element={<RequireOrganizer />}>
          <Route path="/organizer/events" element={<p>protected events</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireOrganizer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'user-1' } })
  })

  it('renders a deterministic loading state without protected content', () => {
    useOrganizer.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch })
    renderRoute()

    expect(screen.getByText('Loading your organizer profile')).toBeInTheDocument()
    expect(screen.queryByText('protected events')).not.toBeInTheDocument()
  })

  it('redirects a missing organizer to setup', () => {
    useOrganizer.mockReturnValue({ data: null, isPending: false, isError: false, refetch })
    renderRoute()

    expect(screen.getByText('organizer setup')).toBeInTheDocument()
    expect(screen.queryByText('protected events')).not.toBeInTheDocument()
  })

  it('redirects an incomplete organizer to setup', () => {
    useOrganizer.mockReturnValue({
      data: { ...completeOrganizer, onboarding_completed_at: null },
      isPending: false,
      isError: false,
      refetch,
    })
    renderRoute()

    expect(screen.getByText('organizer setup')).toBeInTheDocument()
  })

  it('renders the protected outlet for a completed organizer', () => {
    useOrganizer.mockReturnValue({ data: completeOrganizer, isPending: false, isError: false, refetch })
    renderRoute()

    expect(screen.getByText('protected events')).toBeInTheDocument()
  })

  it('keeps setup reachable for an incomplete organizer without invoking its guard', () => {
    renderRoute('/organizer/setup')

    expect(screen.getByText('organizer setup')).toBeInTheDocument()
    expect(useOrganizer).not.toHaveBeenCalled()
  })

  it('renders an explicit query error without protected content', () => {
    useOrganizer.mockReturnValue({
      data: undefined,
      error: new Error('Profile unavailable'),
      isPending: false,
      isError: true,
      refetch,
    })
    renderRoute()

    expect(screen.getByRole('alert')).toHaveTextContent('Your organizer profile could not load')
    expect(screen.queryByText('protected events')).not.toBeInTheDocument()
  })
})
