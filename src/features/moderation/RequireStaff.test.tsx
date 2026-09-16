import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { refetch, useSession, useStaffRole } = vi.hoisted(() => ({
  refetch: vi.fn(),
  useSession: vi.fn(),
  useStaffRole: vi.fn(),
}))

vi.mock('../auth/SessionProvider', () => ({ useSession }))
vi.mock('./moderation.queries', () => ({ useStaffRole }))

import { RequireStaff } from './RequireStaff'

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/moderation']}>
      <Routes>
        <Route element={<RequireStaff />}>
          <Route path="/moderation" element={<p>protected moderation</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireStaff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'staff-1' } })
  })

  it('shows a deterministic loading state without flashing staff content', () => {
    useStaffRole.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch })
    renderGuard()

    expect(useStaffRole).toHaveBeenCalledWith('staff-1')
    expect(screen.getByText('Checking moderation access')).toBeInTheDocument()
    expect(screen.queryByText('protected moderation')).not.toBeInTheDocument()
  })

  it('safely denies a nonstaff or inactive database role', () => {
    useStaffRole.mockReturnValue({ data: null, isPending: false, isError: false, refetch })
    renderGuard()

    expect(screen.getByText('Moderation access required')).toBeInTheDocument()
    expect(screen.queryByText('protected moderation')).not.toBeInTheDocument()
  })
  it('does not classify a missing role response as authoritative denial', () => {
    useStaffRole.mockReturnValue({ data: undefined, isPending: false, isError: false, refetch })
    renderGuard()
    expect(screen.getByRole('alert')).toHaveTextContent('Moderation access could not be confirmed')
    expect(screen.queryByText('Moderation access required')).not.toBeInTheDocument()
  })

  it('retries a bounded role-query failure without rendering staff content', async () => {
    const user = userEvent.setup()
    useStaffRole.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch })
    renderGuard()

    expect(screen.getByRole('alert')).toHaveTextContent('Moderation access could not be confirmed')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it.each(['moderator', 'admin'])('allows an active %s role from the database', (role) => {
    useStaffRole.mockReturnValue({ data: role, isPending: false, isError: false, refetch })
    renderGuard()

    expect(screen.getByText('protected moderation')).toBeInTheDocument()
  })
})
