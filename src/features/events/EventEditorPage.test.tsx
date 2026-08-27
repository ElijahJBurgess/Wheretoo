import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventRequirements } from '../moderation/moderation.types'
import type { EventRow } from './event.types'

const {
  acceptPolicies, closeDialog, locationModuleLoaded, mutateAsync, refetch, saveRequirements,
  saveRevision, showModal, useAcceptCurrentEventPolicies, useOwnedEvent,
  useOwnedEventRequirements, useRequiredEventPolicies, useSaveEventDraft,
  useSaveEventRequirements, useSaveEventRevision, useSession,
} = vi.hoisted(() => ({
  acceptPolicies: vi.fn(), closeDialog: vi.fn(), locationModuleLoaded: vi.fn(), mutateAsync: vi.fn(),
  refetch: vi.fn(), saveRequirements: vi.fn(), saveRevision: vi.fn(), showModal: vi.fn(),
  useAcceptCurrentEventPolicies: vi.fn(), useOwnedEvent: vi.fn(), useOwnedEventRequirements: vi.fn(),
  useRequiredEventPolicies: vi.fn(), useSaveEventDraft: vi.fn(), useSaveEventRequirements: vi.fn(),
  useSaveEventRevision: vi.fn(), useSession: vi.fn(),
}))

vi.mock('../auth/SessionProvider', () => ({ useSession }))
vi.mock('./event.queries', () => ({ useOwnedEvent, useSaveEventDraft, useSaveEventRevision }))
vi.mock('../moderation/moderation.queries', () => ({
  useAcceptCurrentEventPolicies, useOwnedEventRequirements, useRequiredEventPolicies, useSaveEventRequirements,
}))
vi.mock('../../lib/supabase/client', () => ({ supabase: {} }))
vi.mock('./LocationSearchField', () => {
  locationModuleLoaded()
  return { default: ({ onChange }: { onChange: (value: null) => void }) => <button onClick={() => onChange(null)}>Mock address search</button> }
})

import { EventEditorPage } from './EventEditorPage'

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')

function restoreDialogMethod(name: 'close' | 'showModal', descriptor?: PropertyDescriptor) {
  if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
  else delete HTMLDialogElement.prototype[name]
}

const row: EventRow = {
  id: 'event-1', organizer_id: 'organizer-1', status: 'draft', moderation_status: 'clear', content_revision: 1, moderated_revision: null, moderation_version: 0, moderation_updated_at: null, public_history_status: 'never_public', first_publicly_eligible_at: null, public_eligibility_version: 0, publicly_authorized_revision: null, publicly_authorized_action_id: null, title: 'Saved title',
  description: 'Saved description', category: 'community', starts_at: '2026-12-02T02:30:00.000Z',
  ends_at: '2026-12-02T04:00:00.000Z', timezone: 'America/Los_Angeles', venue_name: 'Saved venue',
  address_line1: '1 Market St', address_line2: null, city: 'San Francisco', region: 'CA', postal_code: '94105',
  country_code: 'US', mapbox_feature_id: 'address.saved', latitude: 37.79, longitude: -122.4,
  location: 'computed geography', admission_type: 'free', capacity: 100, artwork_path: null,
  animation_preset: 'generic', published_at: null, created_at: '2026-08-24T12:00:00.000Z',
  updated_at: '2026-08-24T13:00:00.000Z',
}

const organizerTerms = {
  policyKind: 'organizer_terms', label: 'Organizer Terms', versionId: 'dev-organizer-terms-v1',
  stage: 'development_placeholder', publicUrl: '/organizer-terms',
} as const
const eventPolicy = {
  policyKind: 'event_policy', label: 'Event Policy', versionId: 'dev-event-policy-v1',
  stage: 'development_placeholder', publicUrl: '/event-policy',
} as const
const requirements = {
  minimumAge: '21_plus', alcoholPresent: true, cannabisPresent: false, explicitAdultContent: false,
  gamblingPresent: false, weaponsPresent: false, highRiskActivity: false, needsAcceptance: true,
  organizerTerms, eventPolicy,
} as const

type EditorQueryState = {
  data: EventRow | null | undefined
  isPending: boolean
  isError: boolean
  refetch: typeof refetch
}

type RequirementsQueryState = {
  data: EventRequirements | null | undefined
  isPending: boolean
  isError: boolean
  refetch: typeof refetch
}

function renderEditor(
  initialPath = '/organizer/events/new',
  query: EditorQueryState = { data: undefined, isPending: false, isError: false, refetch },
  initialEntries: string[] = [initialPath],
) {
  useOwnedEvent.mockImplementation((requestedEventId: string) =>
    initialPath === '/organizer/events/new' && requestedEventId ? { ...query, data: row } : query,
  )
  const router = createMemoryRouter([
    { path: '/organizer/events/new', element: <EventEditorPage /> },
    { path: '/organizer/events/:eventId/edit', element: <EventEditorPage /> },
    { path: '/organizer/events/:eventId/preview', element: <p>preview destination</p> },
    { path: '/organizer/events/:eventId/tickets', element: <p>ticket setup destination</p> },
    { path: '/away', element: <p>away destination</p> },
  ], { initialEntries, initialIndex: initialEntries.length - 1 })
  return { ...render(<RouterProvider router={router} />), router }
}

describe('EventEditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        value: showModal.mockImplementation(function (this: HTMLDialogElement) {
          this.setAttribute('open', '')
        }),
      },
      close: {
        configurable: true,
        value: closeDialog.mockImplementation(function (this: HTMLDialogElement) {
          this.removeAttribute('open')
        }),
      },
    })
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'organizer-1' } })
    refetch.mockResolvedValue({ data: row })
    mutateAsync.mockResolvedValue(row)
    useSaveEventDraft.mockReturnValue({ isPending: false, mutateAsync })
    useSaveEventRevision.mockReturnValue({ isPending: false, mutateAsync: saveRevision })
    useOwnedEventRequirements.mockReturnValue({ data: requirements, isPending: false, isError: false, refetch })
    useRequiredEventPolicies.mockReturnValue({ data: [organizerTerms, eventPolicy], isPending: false, isError: false, refetch })
    useSaveEventRequirements.mockReturnValue({ isPending: false, mutateAsync: saveRequirements })
    useAcceptCurrentEventPolicies.mockReturnValue({ isPending: false, mutateAsync: acceptPolicies })
  })

  afterEach(() => {
    restoreDialogMethod('showModal', originalShowModal)
    restoreDialogMethod('close', originalClose)
  })

  it('shows the approved seven late-flow stages and does not disclose requirements in the first three', async () => {
    const user = userEvent.setup()
    renderEditor()
    expect(useOwnedEvent).toHaveBeenCalledWith('', 'organizer-1')
    expect(screen.getAllByRole('navigation', { name: 'Event creation progress' })).toHaveLength(1)
    expect(screen.getByText('Basics')).toBeInTheDocument()
    expect(screen.getByText('Date/location')).toBeInTheDocument()
    expect(screen.getByText('Tickets/admission')).toBeInTheDocument()
    expect(screen.getByText('Event details/requirements')).toBeInTheDocument()
    expect(screen.getByText('Organizer agreement')).toBeInTheDocument()
    expect(screen.getByText('Preview')).toBeInTheDocument()
    expect(screen.getByText('Publish')).toBeInTheDocument()
    expect(screen.queryByLabelText('Minimum age')).not.toBeInTheDocument()
    expect(locationModuleLoaded).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    expect(await screen.findByRole('button', { name: 'Mock address search' })).toBeInTheDocument()
    expect(locationModuleLoaded).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    expect(screen.queryByLabelText('Minimum age')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))
    expect(await screen.findByLabelText('Minimum age')).toBeInTheDocument()
    expect(mutateAsync).toHaveBeenCalledOnce()
  })

  it('hydrates an owned row with Los Angeles datetime-local values and ignores a same-route refetch while dirty', async () => {
    const query = { data: row, isPending: false, isError: false, refetch }
    const view = renderEditor('/organizer/events/event-1/edit', query)
    expect(useOwnedEvent).toHaveBeenCalledWith('event-1', 'organizer-1')
    expect(await screen.findByDisplayValue('Saved title')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.clear(screen.getByLabelText('Event title'))
    await user.type(screen.getByLabelText('Event title'), 'Working title')
    useOwnedEvent.mockReturnValue({ ...query, data: { ...row, title: 'Server refetch' } })
    view.rerender(<RouterProvider router={view.router} />)
    expect(screen.getByLabelText('Event title')).toHaveValue('Working title')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-12-01T18:30')
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-12-01T20:00')
  })

  it('renders deterministic loading, retry, and authorization-safe not found states', async () => {
    const user = userEvent.setup()
    const loading = renderEditor('/organizer/events/missing/edit', { data: undefined, isPending: true, isError: false, refetch })
    expect(screen.getByText('Loading your event')).toBeInTheDocument()
    loading.unmount()
    const failed = renderEditor('/organizer/events/missing/edit', { data: undefined, isPending: false, isError: true, refetch })
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledOnce()
    failed.unmount()
    renderEditor('/organizer/events/missing/edit', { data: null, isPending: false, isError: false, refetch })
    expect(screen.getByText('Event not found')).toBeInTheDocument()
    expect(screen.queryByText(/owner|another organizer|permission/i)).not.toBeInTheDocument()
  })

  it('inserts on first save, resets clean, and replace-navigates to the saved edit URL', async () => {
    const user = userEvent.setup()
    mutateAsync.mockResolvedValue({ ...row, title: 'First draft' })
    const { router } = renderEditor()
    await user.type(screen.getByLabelText('Event title'), 'First draft')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1/edit'))
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ eventId: null, organizerId: 'organizer-1' }))
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
    expect(router.state.historyAction).toBe('REPLACE')

    const savedTitle = screen.getByLabelText('Event title')
    await user.clear(savedTitle)
    await user.type(savedTitle, 'Edited after save')
    await act(async () => { await router.navigate('/away') })
    expect(screen.getByRole('dialog')).toHaveTextContent('Leave without saving?')
  })

  it('updates the same ID and retains values with a retry action after failure', async () => {
    const user = userEvent.setup()
    const rawBackendMessage = 'new row violates row-level security policy for table "events"'
    mutateAsync.mockRejectedValueOnce(new Error(rawBackendMessage)).mockResolvedValueOnce({ ...row, title: 'Working title' })
    renderEditor('/organizer/events/event-1/edit', { data: row, isPending: false, isError: false, refetch })
    const title = await screen.findByLabelText('Event title')
    await user.clear(title)
    await user.type(title, 'Working title')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Draft could not be saved. Check your connection and try again.')).toBeInTheDocument()
    expect(screen.queryByText(rawBackendMessage)).not.toBeInTheDocument()
    expect(title).toHaveValue('Working title')
    await user.click(screen.getByRole('button', { name: 'Try saving again' }))
    expect(mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({ eventId: 'event-1', organizerId: 'organizer-1' }))
  })

  it('updates an existing draft without changing history and Back reaches the prior route', async () => {
    const user = userEvent.setup()
    mutateAsync.mockResolvedValue({ ...row, title: 'Canonical saved title' })
    const editPath = '/organizer/events/event-1/edit'
    const { router } = renderEditor(
      editPath,
      { data: row, isPending: false, isError: false, refetch },
      ['/away', editPath],
    )
    const locationKeyBeforeSave = router.state.location.key
    const title = await screen.findByLabelText('Event title')
    await user.clear(title)
    await user.type(title, 'Local edit')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByDisplayValue('Canonical saved title')).toBeInTheDocument()
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event-1' }))
    expect(router.state.location.pathname).toBe(editPath)
    expect(router.state.location.key).toBe(locationKeyBeforeSave)
    expect(router.state.historyAction).toBe('POP')

    await act(async () => { await router.navigate(-1) })
    expect(await screen.findByText('away destination')).toBeInTheDocument()
  })

  it('saves before preview when new or dirty, navigates directly when clean, and prevents rapid duplicate persistence', async () => {
    const user = userEvent.setup()
    let resolve!: (value: EventRow) => void
    mutateAsync.mockReturnValue(new Promise<EventRow>((done) => { resolve = done }))
    const { router } = renderEditor()
    await user.type(screen.getByLabelText('Event title'), 'Preview draft')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))
    expect(mutateAsync).toHaveBeenCalledOnce()
    await act(async () => resolve({ ...row, title: 'Preview draft' }))
    await screen.findByLabelText('Minimum age')
    saveRequirements.mockResolvedValue(requirements)
    acceptPolicies.mockResolvedValue({ ...requirements, needsAcceptance: false })
    await user.click(screen.getByRole('button', { name: 'Continue to organizer agreement' }))
    await user.click(screen.getByRole('checkbox'))
    const preview = screen.getByRole('button', { name: 'Save agreement and preview' })
    await user.dblClick(preview)
    expect(mutateAsync).toHaveBeenCalledOnce()
    await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1/preview'))
  })

  it('previews a clean persisted draft directly without saving again', async () => {
    const user = userEvent.setup()
    const { router } = renderEditor('/organizer/events/event-1/edit', { data: row, isPending: false, isError: false, refetch })
    await screen.findByDisplayValue('Saved title')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))
    await user.click(screen.getByRole('button', { name: 'Continue to organizer agreement' }))
    await user.click(screen.getByRole('checkbox'))
    saveRequirements.mockResolvedValue(requirements)
    acceptPolicies.mockResolvedValue({ ...requirements, needsAcceptance: false })
    await user.click(screen.getByRole('button', { name: 'Save agreement and preview' }))
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(saveRequirements).toHaveBeenCalled()
    expect(saveRequirements.mock.invocationCallOrder[0]).toBeLessThan(acceptPolicies.mock.invocationCallOrder[0])
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/preview')
  })

  it('saves a paid admission selection before routing to ticket setup while free stays in the Day 1 flow', async () => {
    const user = userEvent.setup()
    mutateAsync.mockResolvedValue({ ...row, admission_type: 'paid' })
    renderEditor()
    await user.click(screen.getByLabelText(/^Paid/))
    await user.click(screen.getByRole('button', { name: 'Set up paid tickets' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ values: expect.objectContaining({ admissionType: 'paid' }) })))
    expect(await screen.findByText('ticket setup destination')).toBeInTheDocument()
  })

  it('uses a native modal dialog, treats Escape as Stay, restores focus, and proceeds only on Leave', async () => {
    const user = userEvent.setup()
    const { router, unmount } = renderEditor()
    const title = screen.getByLabelText('Event title')
    await user.type(title, 'Unsaved')
    title.focus()
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await act(async () => { await router.navigate('/away') })
    const firstDialog = screen.getByRole('dialog')
    expect(firstDialog.tagName).toBe('DIALOG')
    expect(showModal).toHaveBeenCalledOnce()
    expect(firstDialog).toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Stay' }))
    expect(router.state.location.pathname).toBe('/organizer/events/new')
    expect(title).toHaveFocus()

    title.focus()
    await act(async () => { await router.navigate('/away') })
    const escapeDialog = screen.getByRole('dialog')
    fireEvent(escapeDialog, new Event('cancel', { cancelable: true }))
    expect(router.state.location.pathname).toBe('/organizer/events/new')
    expect(title).toHaveFocus()

    await act(async () => { await router.navigate('/away') })
    await user.click(screen.getByRole('button', { name: 'Leave' }))
    expect(await screen.findByText('away destination')).toBeInTheDocument()
    expect(closeDialog).toHaveBeenCalled()
    unmount()
    const cleanEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanEvent)
    expect(cleanEvent.defaultPrevented).toBe(false)
  })

  it('keeps dialog semantics in environments without showModal support', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: undefined,
    })
    const user = userEvent.setup()
    const { router } = renderEditor()
    await user.type(screen.getByLabelText('Event title'), 'Unsaved')
    await act(async () => { await router.navigate('/away') })

    expect(screen.getByRole('dialog')).toHaveAttribute('open')
    expect(showModal).not.toHaveBeenCalled()
  })

  it('reloads persisted requirement values from the owner-scoped query', async () => {
    const user = userEvent.setup()
    renderEditor('/organizer/events/event-1/edit', { data: row, isPending: false, isError: false, refetch })

    await screen.findByDisplayValue('Saved title')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))

    expect(screen.getByLabelText('Minimum age')).toHaveValue('21_plus')
    expect(screen.getByRole('radio', { name: 'Yes', description: 'Alcohol present' })).toBeChecked()
    expect(useOwnedEventRequirements).toHaveBeenCalledWith('organizer-1', 'event-1')
  })

  it('gates requirements behind owner-query loading, focused retry, and a safe not-found state', async () => {
    const user = userEvent.setup()
    const eventQuery = { data: row, isPending: false, isError: false, refetch }

    useOwnedEventRequirements.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch })
    const loading = renderEditor('/organizer/events/event-1/edit', eventQuery)
    await screen.findByDisplayValue('Saved title')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))

    expect(screen.getByRole('status')).toHaveTextContent('Loading event requirements')
    expect(screen.queryByLabelText('Minimum age')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue to organizer agreement' })).not.toBeInTheDocument()
    loading.unmount()

    useOwnedEventRequirements.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch })
    const failed = renderEditor('/organizer/events/event-1/edit', eventQuery)
    await screen.findByDisplayValue('Saved title')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))

    const retry = screen.getByRole('button', { name: 'Try loading requirements again' })
    expect(screen.getByRole('alert')).toHaveTextContent('Event requirements could not load')
    expect(retry).toHaveFocus()
    expect(screen.queryByLabelText('Minimum age')).not.toBeInTheDocument()
    await user.click(retry)
    expect(refetch).toHaveBeenCalledOnce()
    failed.unmount()

    useOwnedEventRequirements.mockReturnValue({ data: null, isPending: false, isError: false, refetch })
    renderEditor('/organizer/events/event-1/edit', eventQuery)
    await screen.findByDisplayValue('Saved title')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))

    expect(screen.getByText('Event requirements not found')).toBeInTheDocument()
    expect(screen.queryByText(/owner|another organizer|permission/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue to organizer agreement' })).not.toBeInTheDocument()
  })

  it('hydrates a deferred requirements success once and keeps later user edits across errors and refetches', async () => {
    const user = userEvent.setup()
    const query: RequirementsQueryState = { data: undefined, isPending: true, isError: false, refetch }
    useOwnedEventRequirements.mockImplementation(() => query)
    const view = renderEditor('/organizer/events/event-1/edit', { data: row, isPending: false, isError: false, refetch })
    await screen.findByDisplayValue('Saved title')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))
    expect(screen.queryByLabelText('Minimum age')).not.toBeInTheDocument()

    query.data = requirements
    query.isPending = false
    view.rerender(<RouterProvider router={view.router} />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))
    expect(await screen.findByLabelText('Minimum age')).toHaveValue('21_plus')
    await user.click(screen.getByRole('radio', { name: 'Yes', description: 'Cannabis present' }))

    query.data = undefined
    query.isError = true
    view.rerender(<RouterProvider router={view.router} />)
    query.data = { ...requirements, minimumAge: 'all_ages', cannabisPresent: false }
    query.isError = false
    view.rerender(<RouterProvider router={view.router} />)

    expect(screen.getByLabelText('Minimum age')).toHaveValue('21_plus')
    expect(screen.getByRole('radio', { name: 'Yes', description: 'Cannabis present' })).toBeChecked()
  })

  it('retains edited disclosure values and stays on requirements after a safe server error', async () => {
    const user = userEvent.setup()
    saveRequirements.mockRejectedValue(new Error('private.event_risk_disclosures leaked detail'))
    renderEditor('/organizer/events/event-1/edit', { data: row, isPending: false, isError: false, refetch })

    await screen.findByDisplayValue('Saved title')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))
    await user.click(screen.getByRole('radio', { name: 'Yes', description: 'Cannabis present' }))
    await user.click(screen.getByRole('button', { name: 'Continue to organizer agreement' }))

    expect(await screen.findByText('Event requirements could not be saved. Check your connection and try again.')).toBeInTheDocument()
    expect(screen.queryByText(/private\.event_risk_disclosures/)).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Yes', description: 'Cannabis present' })).toBeChecked()
  })

  it('requires the checkbox and a current returned agreement before navigating to Preview', async () => {
    const user = userEvent.setup()
    saveRequirements.mockResolvedValue(requirements)
    acceptPolicies.mockResolvedValueOnce({ ...requirements, needsAcceptance: true })
      .mockResolvedValueOnce({ ...requirements, needsAcceptance: false })
    const { router } = renderEditor('/organizer/events/event-1/edit', { data: row, isPending: false, isError: false, refetch })

    await screen.findByDisplayValue('Saved title')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))
    await user.click(screen.getByRole('button', { name: 'Continue to organizer agreement' }))
    await user.click(screen.getByRole('button', { name: 'Save agreement and preview' }))
    expect(screen.getAllByText('Confirm the organizer agreement before previewing.')).toHaveLength(2)
    expect(acceptPolicies).not.toHaveBeenCalled()

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Save agreement and preview' }))
    expect(await screen.findByText('Your agreement could not be confirmed. Review it and try again.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/edit')

    await user.click(screen.getByRole('button', { name: 'Try agreement again' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1/preview'))
  })

  it('resets displayed agreement after a material event edit', async () => {
    const user = userEvent.setup()
    useOwnedEventRequirements.mockReturnValue({
      data: { ...requirements, needsAcceptance: false }, isPending: false, isError: false, refetch,
    })
    saveRequirements.mockResolvedValue(requirements)
    renderEditor('/organizer/events/event-1/edit', { data: row, isPending: false, isError: false, refetch })

    await screen.findByDisplayValue('Saved title')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))
    await user.click(screen.getByRole('button', { name: 'Continue to organizer agreement' }))
    expect(screen.getByText('Agreement current for this saved event.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    const title = screen.getByLabelText('Event title')
    await user.clear(title)
    await user.type(title, 'Materially revised title')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))
    await user.click(screen.getByRole('button', { name: 'Continue to organizer agreement' }))

    expect(screen.getByText('Agreement required for these changes.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('allows owner-safe published edits through the revision RPC and preserves blocked or removed status copy', async () => {
    const user = userEvent.setup()
    const publishedBlocked = { ...row, status: 'published', moderation_status: 'blocked', published_at: '2026-08-26T10:00:00Z' } as EventRow
    saveRevision.mockResolvedValue({ ...publishedBlocked, title: 'Revised title', content_revision: 2 })
    renderEditor('/organizer/events/event-1/edit', { data: publishedBlocked, isPending: false, isError: false, refetch })

    expect(await screen.findByText('Blocked')).toBeInTheDocument()
    expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument()
    const title = screen.getByLabelText('Event title')
    await user.clear(title)
    await user.type(title, 'Revised title')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(saveRevision).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event-1', organizerId: 'organizer-1' }))
    expect(await screen.findByText('Blocked')).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('uses the current owner event after requirements persistence instead of masking a moderation refetch', async () => {
    const user = userEvent.setup()
    const publishedClear = { ...row, status: 'published', moderation_status: 'clear', published_at: '2026-08-26T10:00:00Z' } as EventRow
    const savedRevision = { ...publishedClear, title: 'Revised title', content_revision: 2 }
    const underReview = { ...savedRevision, moderation_status: 'under_review' } as EventRow
    const query: EditorQueryState = { data: publishedClear, isPending: false, isError: false, refetch }
    refetch.mockImplementation(async () => {
      query.data = underReview
      return { data: underReview }
    })
    saveRevision.mockResolvedValue(savedRevision)
    saveRequirements.mockResolvedValue(requirements)
    const view = renderEditor('/organizer/events/event-1/edit', query)

    await screen.findByText('Clear')
    const title = screen.getByLabelText('Event title')
    await user.clear(title)
    await user.type(title, 'Revised title')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))
    await user.click(screen.getByRole('radio', { name: 'Yes', description: 'Cannabis present' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    view.rerender(<RouterProvider router={view.router} />)

    expect(saveRevision).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event-1', organizerId: 'organizer-1' }))
    expect(saveRequirements).toHaveBeenCalled()
    expect(refetch).toHaveBeenCalled()
    expect(await screen.findByText('Under review')).toBeInTheDocument()
    expect(screen.queryByText('Clear')).not.toBeInTheDocument()
  })

  it('does not render an identity-mismatched owner event returned by the requirements refetch', async () => {
    const user = userEvent.setup()
    const publishedClear = { ...row, status: 'published', moderation_status: 'clear', published_at: '2026-08-26T10:00:00Z' } as EventRow
    const mismatched = {
      ...publishedClear,
      id: 'other-event',
      organizer_id: 'other-organizer',
      moderation_status: 'removed',
      title: 'Unsafe other event',
    } as EventRow
    const query: EditorQueryState = { data: publishedClear, isPending: false, isError: false, refetch }
    refetch.mockImplementation(async () => {
      query.data = mismatched
      return { data: mismatched }
    })
    saveRequirements.mockResolvedValue(requirements)
    const view = renderEditor('/organizer/events/event-1/edit', query)

    await screen.findByText('Clear')
    await user.click(screen.getByRole('button', { name: 'Continue to date & location' }))
    await user.click(screen.getByRole('button', { name: 'Continue to tickets & admission' }))
    await user.click(screen.getByRole('button', { name: 'Continue to event requirements' }))
    await user.click(screen.getByRole('radio', { name: 'Yes', description: 'Cannabis present' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    view.rerender(<RouterProvider router={view.router} />)

    expect(await screen.findByText('Your event could not load')).toBeInTheDocument()
    expect(screen.queryByText('Unsafe other event')).not.toBeInTheDocument()
    expect(screen.queryByText('Removed')).not.toBeInTheDocument()
  })

  it('rejects a mismatched revision response without reset or navigation', async () => {
    const user = userEvent.setup()
    const publishedRemoved = { ...row, status: 'published', moderation_status: 'removed', published_at: '2026-08-26T10:00:00Z' } as EventRow
    saveRevision.mockResolvedValue({ ...publishedRemoved, id: 'other-event', organizer_id: 'other-organizer', title: 'Unsafe returned title' })
    renderEditor('/organizer/events/event-1/edit', { data: publishedRemoved, isPending: false, isError: false, refetch })

    expect(await screen.findByText('Removed')).toBeInTheDocument()
    const title = screen.getByLabelText('Event title')
    await user.clear(title)
    await user.type(title, 'Keep this local title')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Changes could not be saved. Check your connection and try again.')).toBeInTheDocument()
    expect(title).toHaveValue('Keep this local title')
    expect(screen.queryByDisplayValue('Unsafe returned title')).not.toBeInTheDocument()
  })
})
