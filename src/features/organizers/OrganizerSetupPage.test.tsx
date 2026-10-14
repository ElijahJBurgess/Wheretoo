import { act, render, screen } from '@testing-library/react'
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
        <Route path="/organizer/settings/payments" element={<p>payouts destination</p>} />
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

    expect(screen.getByLabelText('Organizer / business name')).toHaveValue('Avery Stone')
  })

  it('renders accessible validation errors and does not save invalid fields', async () => {
    const user = userEvent.setup()
    renderPage()

    const name = screen.getByLabelText('Organizer / business name')
    await user.clear(name)
    await user.type(name, 'A')
    await user.type(screen.getByLabelText('Website or social (optional)'), 'not a website')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findAllByRole('alert')).toHaveLength(3)
    const summary = screen.getByText('Check the highlighted fields').closest('[role="alert"]')
    expect(summary).toHaveTextContent('Too small')
    expect(summary).toHaveTextContent('Invalid URL')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAttribute('aria-describedby', 'displayName-error')
    expect(screen.getByLabelText('Website or social (optional)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Website or social (optional)')).toHaveAttribute('aria-describedby', 'websiteUrl-error')
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('retains values and renders a server error after a failed save', async () => {
    const user = userEvent.setup()
    mutateAsync.mockRejectedValue(new Error('Profile could not be saved'))
    renderPage()

    await user.click(screen.getByText('More about your organization (optional)'))
    await user.type(screen.getByLabelText('Short description'), 'We host neighborhood art nights.')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Profile could not be saved')).toBeInTheDocument()
    expect(screen.getByLabelText('Short description')).toHaveValue('We host neighborhood art nights.')
  })

  it('clears a stale save error when a resubmission has field validation errors', async () => {
    const user = userEvent.setup()
    mutateAsync.mockRejectedValue(new Error('Profile could not be saved'))
    renderPage()

    await user.click(screen.getByText('More about your organization (optional)'))
    await user.type(screen.getByLabelText('Short description'), 'Keep this description.')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Profile could not be saved')).toBeInTheDocument()

    const name = screen.getByLabelText('Organizer / business name')
    await user.clear(name)
    await user.type(name, 'A')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Check the highlighted fields')).toBeInTheDocument()
    expect(screen.queryByText('Profile save failed')).not.toBeInTheDocument()
    expect(screen.queryByText('Profile could not be saved')).not.toBeInTheDocument()
    expect(name).toHaveAttribute('aria-describedby', 'displayName-error')
    expect(screen.getByLabelText('Short description')).toHaveValue('Keep this description.')
    expect(mutateAsync).toHaveBeenCalledOnce()
  })

  it('disables the save action while the mutation is pending', () => {
    useSaveOrganizer.mockReturnValue({ isPending: true, mutateAsync })
    renderPage()

    expect(screen.getByRole('button', { name: 'Saving profile…' })).toBeDisabled()
  })

  it('saves form values without ownership fields and navigates to the payouts journey', async () => {
    const user = userEvent.setup()
    let resolveSave!: (organizer: { id: string }) => void
    mutateAsync.mockReturnValue(new Promise((resolve) => (resolveSave = resolve)))
    renderPage()

    await user.selectOptions(screen.getByLabelText('Organizer type'), 'Community group')
    await user.click(screen.getByText('More about your organization (optional)'))
    await user.type(screen.getByLabelText('Base city'), 'San Francisco')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(mutateAsync).toHaveBeenCalledWith({
      displayName: 'Avery Stone',
      organizerType: 'Community group',
      bio: '',
      websiteUrl: '',
      baseCity: 'San Francisco',
    })
    expect(screen.queryByText('events destination')).not.toBeInTheDocument()

    resolveSave({ id: 'user-1' })
    expect(await screen.findByText('payouts destination')).toBeInTheDocument()
  })

  it('sends a returning completed organizer to events without repeating setup', async () => {
    useOrganizer.mockReturnValue({ data: { onboarding_completed_at: '2026-09-10' }, isPending: false, isError: false, refetch })
    renderPage()
    expect(await screen.findByText('events destination')).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('does not let a pending profile save navigate a different organizer', async () => {
    const user = userEvent.setup()
    let finishSave!: (value: { id: string }) => void
    mutateAsync.mockReturnValue(new Promise(resolve => { finishSave = resolve }))
    const view = renderPage()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'user-2', user_metadata: {} } })
    useOrganizer.mockReturnValue({ data: { onboarding_completed_at: '2026-09-10' }, isPending: false, isError: false, refetch })
    view.rerender(<MemoryRouter initialEntries={['/organizer/setup']}><Routes>
      <Route path="/organizer/setup" element={<OrganizerSetupPage />} />
      <Route path="/organizer/events" element={<p>events destination</p>} />
      <Route path="/organizer/settings/payments" element={<p>payouts destination</p>} />
    </Routes></MemoryRouter>)
    expect(await screen.findByText('events destination')).toBeInTheDocument()
    await act(async () => finishSave({ id: 'user-1' }))
    expect(screen.getByText('events destination')).toBeInTheDocument()
    expect(screen.queryByText('payouts destination')).not.toBeInTheDocument()
  })

  it('does not treat non-string metadata as a display name', () => {
    useSession.mockReturnValue({
      status: 'authenticated',
      session: {},
      user: { id: 'user-1', user_metadata: { full_name: { id: 'attacker-id' } } },
    })
    renderPage()

    expect(screen.getByLabelText('Organizer / business name')).toHaveValue('')
  })

  it('renders deterministic loading and error states without flashing the form', () => {
    useOrganizer.mockReturnValueOnce({ data: undefined, isPending: true, isError: false, refetch })
    const view = renderPage()

    expect(screen.getByText('Loading your organizer profile')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()

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
