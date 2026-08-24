import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventRow } from './event.types'

const { locationModuleLoaded, mutateAsync, refetch, useOwnedEvent, useSaveEventDraft, useSession } = vi.hoisted(() => ({
  locationModuleLoaded: vi.fn(), mutateAsync: vi.fn(), refetch: vi.fn(), useOwnedEvent: vi.fn(),
  useSaveEventDraft: vi.fn(), useSession: vi.fn(),
}))

vi.mock('../auth/SessionProvider', () => ({ useSession }))
vi.mock('./event.queries', () => ({ useOwnedEvent, useSaveEventDraft }))
vi.mock('../../lib/supabase/client', () => ({ supabase: {} }))
vi.mock('./LocationSearchField', () => {
  locationModuleLoaded()
  return { default: ({ onChange }: { onChange: (value: null) => void }) => <button onClick={() => onChange(null)}>Mock address search</button> }
})

import { EventEditorPage } from './EventEditorPage'

const row: EventRow = {
  id: 'event-1', organizer_id: 'organizer-1', status: 'draft', moderation_status: 'clear', title: 'Saved title',
  description: 'Saved description', category: 'community', starts_at: '2026-12-02T02:30:00.000Z',
  ends_at: '2026-12-02T04:00:00.000Z', timezone: 'America/Los_Angeles', venue_name: 'Saved venue',
  address_line1: '1 Market St', address_line2: null, city: 'San Francisco', region: 'CA', postal_code: '94105',
  country_code: 'US', mapbox_feature_id: 'address.saved', latitude: 37.79, longitude: -122.4,
  location: 'computed geography', admission_type: 'free', capacity: 100, artwork_path: null,
  animation_preset: 'generic', published_at: null, created_at: '2026-08-24T12:00:00.000Z',
  updated_at: '2026-08-24T13:00:00.000Z',
}

type EditorQueryState = {
  data: EventRow | null | undefined
  isPending: boolean
  isError: boolean
  refetch: typeof refetch
}

function renderEditor(
  initialPath = '/organizer/events/new',
  query: EditorQueryState = { data: undefined, isPending: false, isError: false, refetch },
) {
  useOwnedEvent.mockImplementation((requestedEventId: string) =>
    initialPath === '/organizer/events/new' && requestedEventId ? { ...query, data: row } : query,
  )
  const router = createMemoryRouter([
    { path: '/organizer/events/new', element: <EventEditorPage /> },
    { path: '/organizer/events/:eventId/edit', element: <EventEditorPage /> },
    { path: '/organizer/events/:eventId/preview', element: <p>preview destination</p> },
    { path: '/away', element: <p>away destination</p> },
  ], { initialEntries: [initialPath] })
  return { ...render(<RouterProvider router={router} />), router }
}

describe('EventEditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSession.mockReturnValue({ status: 'authenticated', session: {}, user: { id: 'organizer-1' } })
    useSaveEventDraft.mockReturnValue({ isPending: false, mutateAsync })
  })

  it('shows exactly three stages and does not load Mapbox or persist on step changes', async () => {
    const user = userEvent.setup()
    renderEditor()
    expect(useOwnedEvent).toHaveBeenCalledWith('', 'organizer-1')
    expect(screen.getAllByRole('navigation', { name: 'Event creation progress' })).toHaveLength(1)
    expect(screen.getByText('Details')).toBeInTheDocument()
    expect(screen.getByText('Schedule & location')).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(locationModuleLoaded).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Continue to schedule' }))
    expect(await screen.findByRole('button', { name: 'Mock address search' })).toBeInTheDocument()
    expect(locationModuleLoaded).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Continue to review' }))
    expect(mutateAsync).not.toHaveBeenCalled()
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
    await user.click(screen.getByRole('button', { name: 'Continue to schedule' }))
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
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(router.state.historyAction).toBe('REPLACE')

    const savedTitle = screen.getByLabelText('Event title')
    await user.clear(savedTitle)
    await user.type(savedTitle, 'Edited after save')
    await act(async () => { await router.navigate('/away') })
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Leave without saving?')
  })

  it('updates the same ID and retains values with a retry action after failure', async () => {
    const user = userEvent.setup()
    mutateAsync.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({ ...row, title: 'Working title' })
    renderEditor('/organizer/events/event-1/edit', { data: row, isPending: false, isError: false, refetch })
    const title = await screen.findByLabelText('Event title')
    await user.clear(title)
    await user.type(title, 'Working title')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Draft could not be saved')).toBeInTheDocument()
    expect(title).toHaveValue('Working title')
    await user.click(screen.getByRole('button', { name: 'Try saving again' }))
    expect(mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({ eventId: 'event-1', organizerId: 'organizer-1' }))
  })

  it('saves before preview when new or dirty, navigates directly when clean, and prevents rapid duplicate persistence', async () => {
    const user = userEvent.setup()
    let resolve!: (value: EventRow) => void
    mutateAsync.mockReturnValue(new Promise<EventRow>((done) => { resolve = done }))
    const { router } = renderEditor()
    await user.type(screen.getByLabelText('Event title'), 'Preview draft')
    await user.click(screen.getByRole('button', { name: 'Continue to schedule' }))
    await user.click(screen.getByRole('button', { name: 'Continue to review' }))
    const preview = screen.getByRole('button', { name: 'Preview event' })
    await user.dblClick(preview)
    expect(mutateAsync).toHaveBeenCalledOnce()
    await act(async () => resolve({ ...row, title: 'Preview draft' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1/preview'))
  })

  it('previews a clean persisted draft directly without saving again', async () => {
    const user = userEvent.setup()
    const { router } = renderEditor('/organizer/events/event-1/edit', { data: row, isPending: false, isError: false, refetch })
    await screen.findByDisplayValue('Saved title')
    await user.click(screen.getByRole('button', { name: 'Continue to schedule' }))
    await user.click(screen.getByRole('button', { name: 'Continue to review' }))
    await user.click(screen.getByRole('button', { name: 'Preview event' }))
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/organizer/events/event-1/preview')
  })

  it('shows paid as a foundation and warns on review that paid publishing is unavailable', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByLabelText(/^Paid/))
    await user.click(screen.getByRole('button', { name: 'Continue to schedule' }))
    await user.click(screen.getByRole('button', { name: 'Continue to review' }))
    expect(screen.getByText(/Paid event publishing is not available/)).toBeInTheDocument()
  })

  it('blocks internal navigation while dirty, supports Stay and Leave, and cleans up beforeunload prevention', async () => {
    const user = userEvent.setup()
    const { router, unmount } = renderEditor()
    await user.type(screen.getByLabelText('Event title'), 'Unsaved')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await act(async () => { await router.navigate('/away') })
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Leave without saving?')
    await user.click(screen.getByRole('button', { name: 'Stay' }))
    expect(router.state.location.pathname).toBe('/organizer/events/new')
    await act(async () => { await router.navigate('/away') })
    await user.click(screen.getByRole('button', { name: 'Leave' }))
    expect(await screen.findByText('away destination')).toBeInTheDocument()
    unmount()
    const cleanEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanEvent)
    expect(cleanEvent.defaultPrevented).toBe(false)
  })
})
