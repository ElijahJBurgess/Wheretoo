import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { evictPrivateIdentityQueries } from '../auth/privateQueryCache'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { preview, submit, useStatus, refresh } = vi.hoisted(() => ({ preview: vi.fn(), submit: vi.fn(), useStatus: vi.fn(), refresh: vi.fn() }))
vi.mock('./eventChanges.queries', () => ({ useEventNoticeStatus: useStatus }))
vi.mock('./eventChanges.api', async importOriginal => ({ ...await importOriginal<typeof import('./eventChanges.api')>(), previewEventNotice: preview, submitEventNotice: submit }))
vi.mock('../../lib/supabase/client', () => ({ supabase: {} }))
import { EventNoticePanel } from './EventNoticePanel'
import { EventChangeError } from './eventChanges.api'
const eventId = '11111111-1111-4111-8111-111111111111'
const audience = { eventId, purpose: 'event_change' as const, snapshotId: eventId, previewToken: 'a'.repeat(64), complete: true, canSend: true, sourceCount: 2, eligibleMessages: 2, alreadySubmitted: 0, excludedMessages: 0, distinctRecipients: 1, invalidRecipients: 0, blockedRecipients: 0 }
const receipt = { noticeId: '22222222-2222-4222-8222-222222222222', queuedMessages: 2 }
let client = new QueryClient()
function mount() { return render(<QueryClientProvider client={client}><EventNoticePanel eventId={eventId} ownerId="owner-1" purpose="event_change" expectedSnapshotId={eventId} /></QueryClientProvider>) }
beforeEach(() => {
 client = new QueryClient(); vi.clearAllMocks(); sessionStorage.clear(); preview.mockResolvedValue(audience); submit.mockResolvedValue(receipt)
 useStatus.mockReturnValue({ isPending: false, isFetching: false, isError: false, refetch: refresh, data: { eventId, purpose: 'event_change', total: 4, queued: 1, sending: 0, accepted: 1, failed: 1, unknown: 1, suppressed: 0, observations: { sent: 1, delivered: 0, delayed: 0, bounced: 0, complained: 0, failed: 0 } } })
})
describe('explicit reviewed notice submission', () => {
 it('never previews or submits automatically and distinguishes messages from recipient addresses', async () => {
  mount(); expect(preview).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Review notice recipients' }))
  expect(screen.getByText('Eligible messages').nextElementSibling).toHaveTextContent('2')
  expect(screen.getByText('Distinct recipient addresses').nextElementSibling).toHaveTextContent('1')
  expect(submit).not.toHaveBeenCalled()
 })
 it('submits exactly the displayed audience token and reports queued rather than delivered', async () => {
  const user = userEvent.setup(); mount(); await user.click(screen.getByRole('button', { name: 'Review notice recipients' }))
  preview.mockResolvedValue({ ...audience, previewToken: 'b'.repeat(64) })
  await user.click(screen.getByRole('button', { name: 'Submit reviewed notice' }))
  expect(submit).toHaveBeenCalledWith(eventId, 'event_change', audience.previewToken, expect.any(String))
  expect(screen.getByText('2 messages queued. This does not confirm sending or delivery.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Dispatch status' })).toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Provider observations' })).toBeInTheDocument()
 })
 it('retains the request ID across lost-response retry and remount', async () => {
  submit.mockRejectedValueOnce(new Error('lost reply')).mockResolvedValueOnce(receipt)
  const user = userEvent.setup(); const first = mount(); await user.click(screen.getByRole('button', { name: 'Review notice recipients' })); await user.click(screen.getByRole('button', { name: 'Submit reviewed notice' }))
  const original = submit.mock.calls[0]; first.unmount(); mount()
  expect(submit).toHaveBeenCalledOnce(); await user.click(screen.getByRole('button', { name: 'Retry same notice submission' }))
  expect(submit.mock.calls[1]).toEqual(original)
 })
 it('forces a refreshed review after audience conflict', async () => {
  submit.mockRejectedValueOnce(new EventChangeError('conflict')); const user = userEvent.setup(); mount()
  await user.click(screen.getByRole('button', { name: 'Review notice recipients' })); await user.click(screen.getByRole('button', { name: 'Submit reviewed notice' }))
  expect(screen.getByText(/event or audience changed/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Submit reviewed notice' })).not.toBeInTheDocument()
  expect(preview).toHaveBeenCalledOnce(); await user.click(screen.getByRole('button', { name: 'Refresh and review new audience' })); expect(preview).toHaveBeenCalledTimes(2)
 })
 it('guards rapid submission while in flight', async () => {
  let resolve!: (value: typeof receipt) => void; submit.mockReturnValue(new Promise<typeof receipt>(done => { resolve = done }))
  const user = userEvent.setup(); mount(); await user.click(screen.getByRole('button', { name: 'Review notice recipients' })); await user.dblClick(screen.getByRole('button', { name: 'Submit reviewed notice' }))
  expect(submit).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: 'Refresh and review new audience' })).toBeDisabled(); await act(async () => resolve(receipt))
 })
 it('shows incomplete audience and failed status as unavailable, never zero', async () => {
  preview.mockResolvedValue({ ...audience, complete: false, canSend: false, eligibleMessages: null, distinctRecipients: null })
  useStatus.mockReturnValue({ isError: true, refetch: refresh }); mount(); await userEvent.click(screen.getByRole('button', { name: 'Review notice recipients' }))
  expect(screen.getByText('Eligible messages').nextElementSibling).toHaveTextContent('Unavailable'); expect(screen.getByText('Notice status unavailable')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Submit reviewed notice' })).toBeDisabled()
 })
 it('labels no pending audience without resubmitting prior recipients', async () => {
  submit.mockRejectedValueOnce(new EventChangeError('no_audience')); mount(); await userEvent.click(screen.getByRole('button', { name: 'Review notice recipients' })); await userEvent.click(screen.getByRole('button', { name: 'Submit reviewed notice' }))
  expect(screen.getByText(/no pending eligible messages/)).toBeInTheDocument(); expect(submit).toHaveBeenCalledOnce()
 })
 it('refuses a newer server snapshot until the displayed history has been refreshed', async () => {
  preview.mockResolvedValue({ ...audience, snapshotId: '33333333-3333-4333-8333-333333333333' })
  mount(); await userEvent.click(screen.getByRole('button', { name: 'Review notice recipients' }))
  expect(screen.getByText(/Saved event details changed/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Submit reviewed notice' })).not.toBeInTheDocument()
  expect(submit).not.toHaveBeenCalled()
 })

 it('keeps ambiguous exact replay available after the displayed snapshot advances', async () => {
  submit.mockRejectedValueOnce(new Error('lost reply')).mockResolvedValueOnce(receipt)
  const user = userEvent.setup(); const first = mount(); await user.click(screen.getByRole('button', { name: 'Review notice recipients' })); await user.click(screen.getByRole('button', { name: 'Submit reviewed notice' }))
  const original = submit.mock.calls[0]; first.unmount()
  render(<QueryClientProvider client={client}><EventNoticePanel eventId={eventId} ownerId="owner-1" purpose="event_change" expectedSnapshotId="33333333-3333-4333-8333-333333333333" /></QueryClientProvider>)
  await user.click(screen.getByRole('button', { name: 'Retry same notice submission' }))
  expect(submit.mock.calls[1]).toEqual(original)
 })
 it('refreshes parent persisted notice requirement only after confirmed submission', async () => {
  const confirmed = vi.fn()
  render(<QueryClientProvider client={client}><EventNoticePanel eventId={eventId} ownerId="owner-1" purpose="event_change" expectedSnapshotId={eventId} onSubmitted={confirmed} /></QueryClientProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'Review notice recipients' })); expect(confirmed).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Submit reviewed notice' })); expect(confirmed).toHaveBeenCalledOnce()
 })

})

it('Spec11 sign-out during a notice request cannot refresh evicted private history', async () => {
 let finish!: (value: typeof receipt) => void
 submit.mockReturnValue(new Promise(done => { finish = done }))
 const confirmed = vi.fn()
 render(<QueryClientProvider client={client}><EventNoticePanel eventId={eventId} ownerId="owner-1" purpose="event_change" expectedSnapshotId={eventId} onSubmitted={confirmed} /></QueryClientProvider>)
 await userEvent.click(screen.getByRole('button', { name: 'Review notice recipients' }))
 await userEvent.click(screen.getByRole('button', { name: 'Submit reviewed notice' }))
 evictPrivateIdentityQueries(client)
 await act(async () => finish(receipt))
 expect(confirmed).not.toHaveBeenCalled()
 expect(refresh).not.toHaveBeenCalled()
 expect(screen.queryByText('2 messages queued. This does not confirm sending or delivery.')).not.toBeInTheDocument()
})
