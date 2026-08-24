import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mutateAsync, refetch, useOrganizer, useSaveOrganizer, useSession } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  refetch: vi.fn(),
  useOrganizer: vi.fn(),
  useSaveOrganizer: vi.fn(),
  useSession: vi.fn(),
}))

vi.mock('../auth/SessionProvider', () => ({ useSession }))
vi.mock('./organizer.queries', () => ({ useOrganizer, useSaveOrganizer }))

import { OrganizerSetupPage } from './OrganizerSetupPage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/organizer/setup']}>
      <Routes>
        <Route path="/organizer/setup" element={<OrganizerSetupPage />} />
        <Route path="/organizer/events" element={<p>events destination</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('OrganizerSetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSession.mockReturnValue({
      status: 'authenticated',
      session: {},
      user: { id: 'user-1', user_metadata: { full_name: 'Avery Stone' } },
    })
    useOrganizer.mockReturnValue({
      data: null,
      isPending: false,
      isError: false,
      refetch,
    })
    useSaveOrganizer.mockReturnValue({ isPending: false, mutateAsync })
  })

  it('seeds the public display name from auth metadata as a convenience', () => {
    renderPage()

    expect(screen.getByLabelText('Public organizer name')).toHaveValue('Avery Stone')
  })

  it('renders accessible validation errors and does not save invalid fields', async () => {
    const user = userEvent.setup()
    renderPage()

    const name = screen.getByLabelText('Public organizer name')
    await user.clear(name)
    await user.type(name, 'A')
    await user.type(screen.getByLabelText('Website'), 'not a website')
    await user.click(screen.getByRole('button', { name: 'Save organizer profile' }))

    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Website')).toHaveAttribute('aria-invalid', 'true')
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('retains values and renders a server error after a failed save', async () => {
    const user = userEvent.setup()
    mutateAsync.mockRejectedValue(new Error('Profile could not be saved'))
    renderPage()

    await user.type(screen.getByLabelText('Short description'), 'We host neighborhood art nights.')
    await user.click(screen.getByRole('button', { name: 'Save organizer profile' }))

    expect(await screen.findByText('Profile could not be saved')).toBeInTheDocument()
    expect(screen.getByLabelText('Short description')).toHaveValue('We host neighborhood art nights.')
  })

  it('disables the save action while the mutation is pending', () => {
    useSaveOrganizer.mockReturnValue({ isPending: true, mutateAsync })
    renderPage()

    expect(screen.getByRole('button', { name: 'Saving profile…' })).toBeDisabled()
  })

  it('saves form values without ownership fields and navigates to events', async () => {
    const user = userEvent.setup()
    mutateAsync.mockResolvedValue({ id: 'user-1' })
    renderPage()

    await user.selectOptions(screen.getByLabelText('Organizer type'), 'Community group')
    await user.type(screen.getByLabelText('Base city'), 'San Francisco')
    await user.click(screen.getByRole('button', { name: 'Save organizer profile' }))

    expect(mutateAsync).toHaveBeenCalledWith({
      displayName: 'Avery Stone',
      organizerType: 'Community group',
      bio: '',
      websiteUrl: '',
      baseCity: 'San Francisco',
    })
    expect(await screen.findByText('events destination')).toBeInTheDocument()
  })

  it('does not treat non-string metadata as a display name', () => {
    useSession.mockReturnValue({
      status: 'authenticated',
      session: {},
      user: { id: 'user-1', user_metadata: { full_name: { id: 'attacker-id' } } },
    })
    renderPage()

    expect(screen.getByLabelText('Public organizer name')).toHaveValue('')
  })

  it('renders deterministic loading and error states without flashing the form', () => {
    useOrganizer.mockReturnValueOnce({ data: undefined, isPending: true, isError: false, refetch })
    const view = renderPage()

    expect(screen.getByText('Loading your organizer profile')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save organizer profile' })).not.toBeInTheDocument()

    useOrganizer.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch })
    view.rerender(
      <MemoryRouter initialEntries={['/organizer/setup']}>
        <Routes>
          <Route path="/organizer/setup" element={<OrganizerSetupPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Your organizer profile could not load')
  })
})
