import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { testEvent } from '../event-changes/eventChanges.fixtures'

const { readOwner, readPublic } = vi.hoisted(() => ({ readOwner: vi.fn(), readPublic: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: {} }))
vi.mock('./event.api', async original => ({ ...await original<typeof import('./event.api')>(), getOwnedEvent: readOwner }))
vi.mock('../moderation/moderation.api', async original => ({ ...await original<typeof import('../moderation/moderation.api')>(), getPublicEvent: readPublic }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'organizer-1' } }) }))
vi.mock('../organizers/organizer.queries', () => ({ useOrganizer: () => ({ data: { id: 'organizer-1', display_name: 'Local Organizer' }, isPending: false, isError: false }) }))
vi.mock('../moderation/moderation.queries', async original => ({
  ...await original<typeof import('../moderation/moderation.queries')>(),
  useCurrentEventReviewRequest: () => ({ data: null }),
  useRequestEventReview: () => ({ isPending: false }),
  useWithdrawEventReview: () => ({ isPending: false }),
}))
import { PublishedEventPage } from './PublishedEventPage'
import { eventKeys } from './event.queries'
import { moderationKeys } from '../moderation/moderation.queries'

afterEach(() => { onlineManager.setOnline(true); vi.clearAllMocks() })

it('withdraws Live while real cached owner/public queries pause offline, then recovers on reconnect', async () => {
  const event = { ...testEvent, status: 'published', moderation_status: 'clear', moderated_revision: testEvent.content_revision }
  readOwner.mockResolvedValue(event)
  readPublic.mockResolvedValue({ id: event.id })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30000 } } })
  const router = createMemoryRouter([{ path: '/organizer/events/:eventId', element: <PublishedEventPage /> }], { initialEntries: ['/organizer/events/event-1?created=1'] })
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  try {
    await screen.findByRole('heading', { name: 'Your event is live!' })
    act(() => onlineManager.setOnline(false))
    await userEvent.click(screen.getByRole('button', { name: 'Check public availability again' }))
    await waitFor(() => expect(client.getQueryState(eventKeys.detail('organizer-1', event.id))?.fetchStatus).toBe('paused'))
    expect(client.getQueryState(moderationKeys.publicEvent(event.id))?.fetchStatus).toBe('paused')
    expect(screen.queryByRole('link', { name: 'View event' })).not.toBeInTheDocument()
    expect(screen.getByText('Reconnect to check your event’s current status.')).toBeVisible()
    readOwner.mockResolvedValue({ ...event, moderation_status: 'under_review', moderated_revision: null })
    readPublic.mockResolvedValue(null)
    act(() => onlineManager.setOnline(true))
    await screen.findByRole('heading', { name: 'Your event is under review' })
    expect(screen.queryByRole('link', { name: 'View event' })).not.toBeInTheDocument()
  } finally {
    view.unmount(); client.clear(); router.dispose()
  }
})
