import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { testContext, testEvent } from '../event-changes/eventChanges.fixtures'
import type { EventChangeContext } from '../event-changes/eventChanges.schemas'
const { useContext, create, save, requirements, accept, reload, refetch, locationLoaded, useTiers, upload, identity } = vi.hoisted(() => ({ useContext: vi.fn(), create: vi.fn(), save: vi.fn(), requirements: vi.fn(), accept: vi.fn(), reload: vi.fn(), refetch: vi.fn(), locationLoaded: vi.fn(), useTiers: vi.fn(), upload: vi.fn(), identity: { version: 1 } }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => ({ status: 'authenticated', user: { id: 'organizer-1' }, identityVersion: identity.version }) }))
vi.mock('./event.queries', async importOriginal => ({ ...await importOriginal<typeof import('./event.queries')>(), useSaveEventDraft: () => ({ isPending: false, mutateAsync: create }) }))
vi.mock('../event-changes/eventChanges.queries', () => ({ useEventChangeContext: useContext }))
vi.mock('../event-changes/eventChanges.api', async importOriginal => ({ ...await importOriginal<typeof import('../event-changes/eventChanges.api')>(), saveEventIfCurrent: save, saveRequirementsIfCurrent: requirements, acceptPoliciesIfCurrent: accept, getEventChangeContext: reload }))
vi.mock('../moderation/moderation.queries', async importOriginal => ({ ...await importOriginal<typeof import('../moderation/moderation.queries')>(), useRequiredEventPolicies: () => ({ data: [] }) }))
vi.mock('../tickets/ticket.queries', async importOriginal => ({ ...await importOriginal<typeof import('../tickets/ticket.queries')>(), useOwnedTicketTiers: useTiers }))
vi.mock('../event-images/eventImages.queries', () => ({ useEventImages: () => ({ data: [], isPending: false, isError: false }) }))
vi.mock('../event-images/eventImages.api', () => ({ uploadEventImage: upload, removeEventImage: vi.fn(), reorderEventImages: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: {} }))
vi.mock('./LocationSearchField', () => { locationLoaded(); return { default: () => <button>Mock address search</button> } })
import { EventEditorPage } from './EventEditorPage'
import { EventChangeError } from '../event-changes/eventChanges.api'
let current: EventChangeContext
function renderEditor(path = '/organizer/events/event-1/edit?step=basics', initialEntries = [path]) {
 const router = createMemoryRouter([
  { path: '/organizer/events/new', element: <EventEditorPage /> }, { path: '/organizer/events/:eventId/edit', element: <EventEditorPage /> },
  { path: '/organizer/events/:eventId/preview', element: <p>preview destination</p> }, { path: '/organizer/events/:eventId/tickets', element: <p>ticket setup destination</p> },
  { path: '/away', element: <p>away destination</p> },
 ], { initialEntries, initialIndex: initialEntries.length - 1 })
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 return { router, client, ...render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>) }
}
async function toRequirements(user: ReturnType<typeof userEvent.setup>) {
 await user.click(screen.getByRole('button', { name: 'Continue' }))
 await user.click(screen.getByRole('button', { name: 'Continue' }))
 await user.click(screen.getByRole('button', { name: 'Continue' }))
}
beforeEach(() => {
 vi.clearAllMocks(); identity.version = 1; current = testContext()
 useContext.mockImplementation((eventId: string) => ({ data: eventId ? current : undefined, isPending: false, isFetching: false, isError: false, refetch }))
 create.mockResolvedValue(testEvent)
 save.mockImplementation(async (_id, _owner, _token, values) => { current = { ...current, context_token: 'saved-token', event: { ...current.event, title: values.title, admission_type: values.admissionType } }; return current })
 requirements.mockImplementation(async (_id, _owner, _token, values) => { current = { ...current, context_token: 'requirements-token', requirements: { ...current.requirements, ...values } }; return current })
 accept.mockImplementation(async () => { if (!current.requirements.organizerTerms || !current.requirements.eventPolicy) throw new Error('Policies unavailable'); current = { ...current, context_token: 'accepted-token', requirements: { ...current.requirements, needsAcceptance: false } }; return current })
 reload.mockImplementation(async () => current)
 useTiers.mockReturnValue({ data: [], isPending: false, isError: false })
 Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value() { this.setAttribute('open', '') } }, close: { configurable: true, value() { this.removeAttribute('open') } },
 })
})
describe('atomic-context event editor', () => {
 it('silently saves the entered Basics before artwork and stays on Basics with the real draft', async () => {
  let finishUpload!: () => void
  upload.mockImplementation(() => new Promise<void>(resolve => { finishUpload = resolve }))
  const user = userEvent.setup(); const { router } = renderEditor('/organizer/events/new')
  await user.type(screen.getByLabelText('Event name'), 'Artwork draft')
  await user.upload(screen.getByLabelText('Upload images'), new File(['png'], 'flyer.png', { type: 'image/png' }))
  await waitFor(() => expect(upload).toHaveBeenCalledWith('event-1', expect.any(File), expect.any(Function)))
  expect(create).toHaveBeenCalledOnce()
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ values: expect.objectContaining({ title: 'Artwork draft' }) }))
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  expect(router.state.location.pathname).toBe('/organizer/events/new')
  const leave = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(leave)
  expect(leave.defaultPrevented).toBe(true)
  await act(async () => finishUpload())
  await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1/edit'))
  expect(router.state.location.search).toBe('?step=basics')
  expect(screen.getByLabelText('Upload images')).toBeEnabled()
 })
 it('releases artwork busy state for a replacement same-owner session and ignores the old completion', async () => {
  let finishUpload!: () => void
  upload.mockImplementation(() => new Promise<void>(resolve => { finishUpload = resolve }))
  const { router } = renderEditor('/organizer/events/new')
  await userEvent.setup().upload(screen.getByLabelText('Upload images'), new File(['png'], 'flyer.png', { type: 'image/png' }))
  await waitFor(() => expect(upload).toHaveBeenCalledOnce())
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  identity.version = 2
  await act(async () => router.navigate('/organizer/events/new?session=2'))
  // The unsaved-navigation guard still applies to a route navigation.
  if (screen.queryByRole('button', { name: 'Leave without saving' })) await userEvent.click(screen.getByRole('button', { name: 'Leave without saving' }))
  await waitFor(() => expect(screen.getByLabelText('Upload images')).toBeEnabled())
  await act(async () => finishUpload())
  expect(router.state.location.pathname).toBe('/organizer/events/new')
 })
 it('keeps the persisted draft when its image upload fails so retry cannot create another draft', async () => {
  upload.mockRejectedValue(new Error('Upload response lost.'))
  const user = userEvent.setup(); const { router } = renderEditor('/organizer/events/new')
  const unsavedInput = screen.getByLabelText('Upload images')
  await user.upload(screen.getByLabelText('Upload images'), new File(['png'], 'flyer.png', { type: 'image/png' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1/edit'))
  expect(screen.getByText(/Your draft is saved. Upload response lost/)).toBeInTheDocument()
  await waitFor(() => expect(screen.getByLabelText('Upload images')).not.toBe(unsavedInput))
  await waitFor(() => expect(screen.getByLabelText('Upload images')).toBeEnabled())
  await user.upload(screen.getByLabelText('Upload images'), new File(['png'], 'flyer.png', { type: 'image/png' }))
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
  expect(create).toHaveBeenCalledOnce()
 })
 it('does not attach artwork to a returned draft owned by somebody else', async () => {
  create.mockResolvedValue({ ...testEvent, organizer_id: 'other-owner' })
  const { router } = renderEditor('/organizer/events/new')
  await userEvent.setup().upload(screen.getByLabelText('Upload images'), new File(['png'], 'flyer.png', { type: 'image/png' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('SAVED_EVENT_IDENTITY_MISMATCH')
  expect(upload).not.toHaveBeenCalled()
  expect(router.state.location.pathname).toBe('/organizer/events/new')
 })
 it('validates Basics before persisting and resumes a paid draft from its saved tiers', async () => {
  const user = userEvent.setup(); const first = renderEditor('/organizer/events/new')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect((await screen.findAllByText('Title must be between 3 and 120 characters.'))[0]).toBeInTheDocument()
  expect(create).not.toHaveBeenCalled()
  first.unmount()

  current = testContext({ ...testEvent, admission_type: 'paid' })
  useTiers.mockReturnValue({ data: [{ id: 'tier-1', status: 'draft' }], isPending: false, isError: false })
  const resumed = renderEditor('/organizer/events/event-1/edit?resume=1')
  expect(await screen.findByRole('heading', { name: 'Event Details' })).toBeInTheDocument()
  expect(useTiers).toHaveBeenCalledWith('organizer-1', 'event-1')
  resumed.unmount()
 })

 it('does not enable a paid-tier read for a free draft', () => {
  renderEditor('/organizer/events/event-1/edit?step=details')
  expect(useTiers).toHaveBeenCalledWith('organizer-1', '')
 })
 it('preserves the seven stages and loads address UI only at the location stage', async () => {
  const user = userEvent.setup(); renderEditor('/organizer/events/new')
  expect(screen.getByRole('navigation', { name: 'Event creation progress' })).toBeInTheDocument()
  for (const text of ['Basics', 'Date & Location', 'Ticket Type', 'Event Details', 'Preview', 'Publish Confirmation', 'Publication Outcome']) expect(screen.getAllByText(text).length).toBeGreaterThan(0)
  expect(screen.queryByLabelText('Minimum age')).not.toBeInTheDocument()
  await user.type(screen.getByLabelText('Event name'), 'New event')
  await user.type(screen.getByLabelText('Description'), 'A complete description for the new event.')
  await user.selectOptions(screen.getByLabelText('Category'), 'community')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByText('Mock address search')).toBeInTheDocument()
 })
 it('hydrates event and requirements from the same context and opens ticket-setup requirements handoff', async () => {
  renderEditor('/organizer/events/event-1/edit?step=requirements')
  expect(await screen.findByLabelText('Minimum age')).toHaveValue('21_plus')
  expect(screen.queryByLabelText('Event title')).not.toBeInTheDocument()
  expect(useContext).toHaveBeenCalledWith('event-1', 'organizer-1')
 })
 it('pins the original token and dirty inputs through a newer background context', async () => {
  const user = userEvent.setup(); const view = renderEditor()
  await user.clear(screen.getByLabelText(/Event (?:name|title)/)); await user.type(screen.getByLabelText(/Event (?:name|title)/), 'Working title')
  current = testContext({ ...testEvent, title: 'Other writer' }, 'newer-token')
  await act(async () => view.router.navigate('/organizer/events/event-1/edit?refresh'))
  expect(screen.getByLabelText(/Event (?:name|title)/)).toHaveValue('Working title')
  await user.click(screen.getByRole('button', { name: 'Save draft' }))
  expect(save).toHaveBeenCalledWith('event-1', 'organizer-1', 'baseline-token', expect.objectContaining({ title: 'Working title' }))
 })
 it('rejects a late save after an A to B to A event switch', async () => {
  let resolveSave!: (value: EventChangeContext) => void
  save.mockReturnValue(new Promise<EventChangeContext>((resolve) => { resolveSave = resolve }))
  const user = userEvent.setup(); const { router } = renderEditor()
  await user.click(screen.getByRole('button', { name: 'Save draft' }))
  await act(async () => router.navigate('/organizer/events/event-2/edit?step=basics'))
  await act(async () => router.navigate('/organizer/events/event-1/edit?step=basics'))
  await act(async () => resolveSave(testContext({ ...testEvent, title: 'Late event-one write' }, 'late-token')))
  expect(screen.queryByDisplayValue('Late event-one write')).not.toBeInTheDocument()
  expect(screen.getByDisplayValue('Saved title')).toBeInTheDocument()
 })
 it('preserves Los Angeles datetime-local conversion', async () => {
  const user = userEvent.setup(); renderEditor()
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByLabelText('Starts')).toHaveValue('2027-12-01T18:30')
  expect(screen.getByLabelText('Ends')).toHaveValue('2027-12-01T20:00')
 })
 it('shows loading and retries an atomic owner-context failure without leaking identities', async () => {
  useContext.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch }); const view = renderEditor()
  expect(screen.getByText('Loading your event')).toBeInTheDocument()
  useContext.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch }); await act(async () => view.router.navigate('/organizer/events/event-1/edit?refresh'))
  await userEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(refetch).toHaveBeenCalledOnce()
  expect(screen.queryByText(/another organizer|permission/i)).not.toBeInTheDocument()
 })
 it('does not display a mismatched owned context', () => {
  current = testContext({ ...testEvent, organizer_id: 'other-owner', title: 'Private title' }); renderEditor()
  expect(screen.getByText('Your event could not load')).toBeInTheDocument(); expect(screen.queryByText('Private title')).not.toBeInTheDocument()
 })
 it('only creates on first save and replace-navigates to the same new event', async () => {
  const user = userEvent.setup(); const { router } = renderEditor('/organizer/events/new')
  await user.type(screen.getByLabelText(/Event (?:name|title)/), 'First draft'); await user.click(screen.getByRole('button', { name: 'Save draft' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1/edit'))
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ eventId: null, organizerId: 'organizer-1' }))
  expect(save).not.toHaveBeenCalled(); expect(router.state.historyAction).toBe('REPLACE')
 })
 it('saves a paid first selection before routing to real ticket setup', async () => {
  create.mockResolvedValue(testEvent); const user = userEvent.setup(); const { router } = renderEditor('/organizer/events/new')
  await user.type(screen.getByLabelText('Event name'), 'Paid event')
  await user.type(screen.getByLabelText('Description'), 'A complete paid event description.')
  await user.selectOptions(screen.getByLabelText('Category'), 'community')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(await screen.findByRole('button', { name: 'Continue' }))
  await user.click(screen.getByRole('radio', { name: /Paid Tickets/ }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/organizer/events/event-1/tickets'))
  expect(create).toHaveBeenCalledOnce()
  expect(save).toHaveBeenCalledWith('event-1', 'organizer-1', expect.any(String), expect.objectContaining({ admissionType: 'paid' }))
 })
 it('saves an existing draft conditionally without changing route history', async () => {
  const user = userEvent.setup(); const { router } = renderEditor('/organizer/events/event-1/edit?step=basics', ['/away', '/organizer/events/event-1/edit?step=basics'])
  const key = router.state.location.key
  await user.type(screen.getByLabelText(/Event (?:name|title)/), ' edited'); await user.click(screen.getByRole('button', { name: 'Save draft' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Draft saved' })).toBeInTheDocument())
  expect(create).not.toHaveBeenCalled(); expect(router.state.location.key).toBe(key)
  await act(async () => router.navigate(-1)); expect(await screen.findByText('away destination')).toBeInTheDocument()
 })
 it.each(['conflict', 'unknown'] as const)('preserves intent and disables writes after %s until deliberate protected reload', async kind => {
  save.mockRejectedValue(new EventChangeError(kind)); const user = userEvent.setup(); renderEditor()
  await user.clear(screen.getByLabelText(/Event (?:name|title)/)); await user.type(screen.getByLabelText(/Event (?:name|title)/), 'Keep my intent')
  await user.click(screen.getByRole('button', { name: 'Save draft' }))
  expect(await screen.findByText(kind === 'conflict' ? 'Conflict' : 'Unknown')).toBeInTheDocument()
  expect(screen.getByLabelText(/Event (?:name|title)/)).toHaveValue('Keep my intent'); expect(screen.getByRole('button', { name: 'Try saving again' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Reload saved version' })); expect(reload).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Keep reviewing my inputs' })); expect(screen.getByLabelText(/Event (?:name|title)/)).toHaveValue('Keep my intent')
  current = testContext({ ...testEvent, title: 'Server version' }, 'reload-token')
  await user.click(screen.getByRole('button', { name: 'Reload saved version' })); await user.click(screen.getByRole('button', { name: 'Discard inputs and reload' }))
  expect(await screen.findByDisplayValue('Server version')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled()
 })
 it('checks even clean saves and advances tokens only from its own atomic write envelopes before policy acceptance', async () => {
  const user = userEvent.setup(); const { router } = renderEditor()
  await toRequirements(user)
  await user.click(screen.getByRole('checkbox')); await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(save).toHaveBeenCalledTimes(4)
  expect(requirements).toHaveBeenLastCalledWith('event-1', 'organizer-1', 'saved-token', expect.any(Object))
  expect(accept).toHaveBeenCalledWith('event-1', 'organizer-1', 'requirements-token')
  expect(reload).not.toHaveBeenCalled(); expect(refetch).not.toHaveBeenCalled()
  expect(router.state.location.pathname).toBe('/organizer/events/event-1/preview')
 })
 it('guards double saves while persistence is pending', async () => {
  let resolve!: (value: EventChangeContext) => void; save.mockReturnValue(new Promise<EventChangeContext>(done => { resolve = done }))
  const user = userEvent.setup(); renderEditor(); await user.dblClick(screen.getByRole('button', { name: 'Save draft' }))
  expect(save).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  await act(async () => resolve(current))
 })
 it('retains dirty requirements while its own event save advances the baseline', async () => {
  const user = userEvent.setup(); renderEditor('/organizer/events/event-1/edit?step=requirements')
  await user.click(screen.getByRole('radio', { name: 'Yes', description: 'Cannabis present' }))
  await user.click(screen.getByRole('button', { name: 'Back' })); await user.click(screen.getByRole('button', { name: 'Back' })); await user.click(screen.getByRole('button', { name: 'Back' }))
  await user.type(screen.getByLabelText(/Event (?:name|title)/), ' revised'); await user.click(screen.getByRole('button', { name: 'Save draft' }))
  await user.click(screen.getByRole('button', { name: 'Continue Editing' }))
  await toRequirements(user)
  expect(screen.getByRole('radio', { name: 'Yes', description: 'Cannabis present' })).toBeChecked()
  // Draft Event Details combines disclosures and agreement in one persisted step.
  expect(requirements).toHaveBeenCalledWith('event-1', 'organizer-1', 'saved-token', expect.objectContaining({ cannabisPresent: true }))
 })
 it('retains requirements and suppresses raw backend details on a lost requirements reply', async () => {
  requirements.mockRejectedValue(new Error('private database detail')); const user = userEvent.setup(); renderEditor('/organizer/events/event-1/edit?step=requirements')
  await user.click(screen.getByRole('radio', { name: 'Yes', description: 'Cannabis present' })); await user.click(screen.getByRole('checkbox')); await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByText('Unknown')).toBeInTheDocument(); expect(screen.getByRole('radio', { name: 'Yes', description: 'Cannabis present' })).toBeChecked()
  expect(screen.queryByText('private database detail')).not.toBeInTheDocument(); expect(accept).not.toHaveBeenCalled()
 })
 it('requires the agreement checkbox and a current returned acceptance before preview', async () => {
  const user = userEvent.setup(); const { router } = renderEditor('/organizer/events/event-1/edit?step=requirements')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(accept).not.toHaveBeenCalled()
  accept.mockResolvedValueOnce(current)
  await user.click(screen.getByRole('checkbox')); await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(router.state.location.pathname).toContain('/edit'); expect(screen.getByRole('button', { name: 'Try agreement again' })).toBeInTheDocument()
 })
 it.each(['blocked', 'removed'] as const)('allows same-event published %s edits and never clones', async moderation_status => {
  current = testContext({ ...testEvent, status: 'published', moderation_status }); const user = userEvent.setup(); renderEditor()
  expect(screen.getByText(moderation_status === 'blocked' ? 'Blocked' : 'Removed')).toBeInTheDocument()
  await user.type(screen.getByLabelText('Event title'), ' revision'); await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(save).toHaveBeenCalledWith('event-1', 'organizer-1', 'baseline-token', expect.any(Object)); expect(create).not.toHaveBeenCalled()
 })
 it('uses atomic requirements response moderation state without a racy post-save fetch', async () => {
  current = testContext({ ...testEvent, status: 'published', moderation_status: 'clear' })
  requirements.mockImplementation(async () => ({ ...current, context_token: 'requirements-token', event: { ...current.event, moderation_status: 'under_review' } }))
  const user = userEvent.setup(); renderEditor('/organizer/events/event-1/edit?step=requirements')
  await user.click(screen.getByRole('button', { name: 'Continue to organizer agreement' }))
  expect(await screen.findByText('Under review')).toBeInTheDocument(); expect(refetch).not.toHaveBeenCalled()
 })
 it('prevents editing a cancelled event', () => { current = testContext({ ...testEvent, status: 'cancelled' }); renderEditor(); expect(screen.getByText('Event editing unavailable')).toBeInTheDocument(); expect(screen.queryByLabelText('Event title')).not.toBeInTheDocument() })
 it('retains native unsaved dialog, Escape-as-stay, focus, and deliberate leave behavior', async () => {
  const user = userEvent.setup(); const { router } = renderEditor()
  const title = screen.getByLabelText(/Event (?:name|title)/); await user.type(title, ' dirty')
  await act(async () => router.navigate('/away'))
  expect(screen.getByRole('dialog')).toHaveTextContent('Leave without saving?')
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(title).toHaveFocus()
  await act(async () => router.navigate('/away')); await user.click(screen.getByRole('button', { name: 'Leave' }))
  expect(await screen.findByText('away destination')).toBeInTheDocument()
 })
})

it('keeps draft location, ticket type, details and images available when publication policy is unconfigured', async () => {
 current = { ...testContext(), requirements: { ...testContext().requirements, needsAcceptance: true, organizerTerms: null, eventPolicy: null } }
 const user = userEvent.setup()
 const view = renderEditor('/organizer/events/event-1/edit?step=date-location')
 expect(await screen.findByText('Mock address search')).toBeInTheDocument()
 expect(screen.queryByText('Your event could not load')).not.toBeInTheDocument()
 await user.click(screen.getByRole('button', { name: 'Continue' }))
 expect(await screen.findByRole('heading', { name: 'Ticket Type' })).toBeInTheDocument()
 await user.click(screen.getByRole('button', { name: 'Continue' }))
 expect(await screen.findByRole('heading', { name: 'Event Details' })).toBeInTheDocument()
 expect(screen.getByText('Publication policies are not available')).toBeInTheDocument()
 expect(screen.getByLabelText('Upload images')).toBeInTheDocument()
 expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
 expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled()
 expect(accept).not.toHaveBeenCalled()
 view.unmount()
 renderEditor('/organizer/events/event-1/edit?step=date-location')
 expect(await screen.findByText('Mock address search')).toBeInTheDocument()
})
