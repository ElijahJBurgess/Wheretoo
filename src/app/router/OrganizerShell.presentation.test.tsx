import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { useSession, useSignOut, useStaffRole, useOwnedEvent } = vi.hoisted(() => ({
  useSession: vi.fn(),
  useSignOut: vi.fn(),
  useStaffRole: vi.fn(),
  useOwnedEvent: vi.fn(() => ({ data: { status: "draft", admission_type: "free" } })),
}))

vi.mock('../../features/auth/SessionProvider', () => ({ useSession }))
vi.mock('../../features/auth/SignOutProvider', () => ({ useSignOut }))
vi.mock('../../features/moderation/moderation.queries', () => ({ useStaffRole }))
vi.mock('../../features/events/event.queries', () => ({ useOwnedEvent }))

import { OrganizerShell } from './OrganizerShell'

function renderPath(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<OrganizerShell />}>
          <Route path={path.split('?')[0]} element={<h1>Onboarding content</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('OrganizerShell onboarding presentation boundary', () => {
  beforeEach(() => {
    useSession.mockReturnValue({ status: 'authenticated', user: { id: 'organizer-1' } })
    useStaffRole.mockReturnValue({ data: null })
    useSignOut.mockReturnValue({ error: null, pending: false, signOut: vi.fn() })
  })

  it.each(['/organizer/setup', '/organizer/settings/payments', '/organizer/events/new', '/organizer/events/00000000-0000-4000-8000-000000000001/edit?resume=1', '/organizer/events/00000000-0000-4000-8000-000000000001/edit?step=details', '/organizer/events/00000000-0000-4000-8000-000000000001/tickets', '/organizer/events/00000000-0000-4000-8000-000000000001/preview', '/organizer/events/00000000-0000-4000-8000-000000000001?created=1'])(
    'leaves the full-frame onboarding layout unwrapped at %s',
    (path) => {
      renderPath(path)

      expect(screen.getByRole('heading', { name: 'Onboarding content' })).toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: 'Organizer operations' })).not.toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: 'Organizer' })).not.toBeInTheDocument()
    },
  )
})

it('suppresses late sign-out navigation after the identity lifetime changes', async () => {
  useSession.mockReturnValue({ status: 'authenticated', user: { id: 'organizer-1' } })
  useStaffRole.mockReturnValue({ data: null })
  useSignOut.mockReturnValue({ error: null, pending: false, signOut: async () => ({ localSignedOut: true, remoteRevoked: true, isCurrent: () => false }) })
  render(<MemoryRouter initialEntries={['/organizer/settings/profile']}><Routes><Route element={<OrganizerShell />}><Route path="/organizer/settings/profile" element={<p>Replacement content</p>} /></Route><Route path="/auth/sign-in" element={<p>Stale navigation</p>} /></Routes></MemoryRouter>)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))
  expect(screen.getByText('Replacement content')).toBeInTheDocument()
  expect(screen.queryByText('Stale navigation')).not.toBeInTheDocument()
})
