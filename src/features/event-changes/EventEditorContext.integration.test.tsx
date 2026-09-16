import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { testContext, testEvent } from './eventChanges.fixtures'
import type { EventChangeContext } from './eventChanges.schemas'
const { readContext, save } = vi.hoisted(() => ({ readContext: vi.fn(), save: vi.fn() }))
vi.mock('./eventChanges.api', async importOriginal => ({ ...await importOriginal<typeof import('./eventChanges.api')>(), getEventChangeContext: readContext, saveEventIfCurrent: save }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'organizer-1' } }) }))
vi.mock('../moderation/moderation.queries', async importOriginal => ({ ...await importOriginal<typeof import('../moderation/moderation.queries')>(), useRequiredEventPolicies: () => ({ data: [] }) }))
vi.mock('../../lib/supabase/client', () => ({ supabase: {} }))
import { EventEditorPage } from '../events/EventEditorPage'
import { evictPrivateIdentityQueries } from '../auth/privateQueryCache'
function mount(client: QueryClient) {
 const router = createMemoryRouter([{ path: '/organizer/events/:eventId/edit', element: <EventEditorPage /> }], { initialEntries: ['/organizer/events/event-1/edit'] })
 return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}
it('uses real query revalidation for cached edit → save → detail/list → reopen without freezing old context', async () => {
 const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30000, retry: false } } })
 const key = ['event-change-context', 'organizer-1', 'event-1']
 const cached = testContext({ ...testEvent, title: 'Old cached title' }, 'old')
 client.setQueryData(key, cached); client.setQueryData(['events', 'owned', 'organizer-1'], [cached.event])
 let resolve!: (value: EventChangeContext) => void
 readContext.mockReturnValue(new Promise<EventChangeContext>(done => { resolve = done }))
 const first = mount(client)
 expect(screen.getByText('Loading your event')).toBeInTheDocument(); expect(screen.queryByDisplayValue('Old cached title')).not.toBeInTheDocument()
 const fresh = testContext({ ...testEvent, title: 'Fresh title' }, 'fresh')
 await act(async () => resolve(fresh)); expect(await screen.findByDisplayValue('Fresh title')).toBeInTheDocument()
 const saved = testContext({ ...testEvent, title: 'Saved own edit' }, 'own-write')
 save.mockResolvedValue(saved)
 const user = userEvent.setup(); await user.clear(screen.getByLabelText('Event title')); await user.type(screen.getByLabelText('Event title'), 'Saved own edit'); await user.click(screen.getByRole('button', { name: 'Save draft' }))
 await waitFor(() => expect(client.getQueryData(key)).toEqual(saved))
 expect(client.getQueryData(['events', 'detail', 'organizer-1', 'event-1'])).toEqual(saved.event)
 expect(client.getQueryState(['events', 'owned', 'organizer-1'])?.isInvalidated).toBe(true)
 first.unmount()
 readContext.mockReturnValue(new Promise<EventChangeContext>(done => { resolve = done }))
 mount(client); expect(screen.getByText('Loading your event')).toBeInTheDocument(); expect(screen.queryByDisplayValue('Saved own edit')).not.toBeInTheDocument()
 const newer = testContext({ ...testEvent, title: 'Another verified write' }, 'newer')
 await act(async () => resolve(newer)); expect(await screen.findByDisplayValue('Another verified write')).toBeInTheDocument()
})
it('removed private queries do not repopulate after an in-flight read settles', async () => {
 const client = new QueryClient()
 let resolve!: (value: string) => void
 const pending = new Promise<string>(done => { resolve = done })
 const keys = ['event-change-context', 'event-notice-status', 'event-cancellation-summary'].map(scope => [scope, 'owner', 'event'])
 const reads = keys.map(queryKey => client.fetchQuery({ queryKey, queryFn: () => pending }).catch(() => undefined))
 evictPrivateIdentityQueries(client); resolve('old private result'); await Promise.all(reads)
 for (const key of keys) expect(client.getQueryData(key)).toBeUndefined()
})

it('Spec11 sign-out invalidation blocks a pending editor write before Auth removal', async () => {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 readContext.mockResolvedValueOnce(testContext(testEvent, 'before')).mockImplementation(() => new Promise(() => {}))
 let finish!: (value: EventChangeContext) => void
 save.mockReturnValue(new Promise(done => { finish = done }))
 mount(client)
 await screen.findByLabelText('Event title')
 await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))
 await waitFor(() => expect(finish).toBeTypeOf('function'))
 evictPrivateIdentityQueries(client)
 await act(async () => finish(testContext({ ...testEvent, title: 'Late private save' }, 'after')))
 expect(client.getQueryData(['events', 'detail', 'organizer-1', 'event-1'])).toBeUndefined()
 expect(client.getQueryData(['event-change-context', 'organizer-1', 'event-1'])).toBeUndefined()
})
