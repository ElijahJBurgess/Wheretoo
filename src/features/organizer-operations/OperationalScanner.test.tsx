import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { OperationsReadError } from './operations.errors'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CameraDecoder } from '../ticket-experience/scanner/scannerMachine'
const { useEventMetrics, useOperationsMetrics, useSession } = vi.hoisted(() => ({ useEventMetrics: vi.fn(), useOperationsMetrics: vi.fn(), useSession: vi.fn() }))
vi.mock('./operations.queries', () => ({ useEventMetrics, useOperationsMetrics, operationsKeys: { event: () => ['organizer-operations', 'owner', 'event'] } }))
vi.mock('../auth/SessionProvider', () => ({ useSession }))
import { OperationalScanner } from './OperationalScanner'
beforeEach(() => {
  useOperationsMetrics.mockImplementation(() => useEventMetrics())
})

it('dispatches free scanner metrics without mounting the paid reader', async () => {
  useSession.mockReturnValue({ status: 'authenticated', identityVersion: 8, user: { id: 'owner' } })
  useOperationsMetrics.mockReturnValue({ data: { eventId: 'a6200000-0000-4000-8000-000000000001', checkedIn: 0, issued: 3 }, isPending: false, isError: false })
  const camera: CameraDecoder = { start: vi.fn<CameraDecoder['start']>(async () => ({ kind: 'ready' })), stop: vi.fn() }
  const checker = { checkAdmission: vi.fn() }
  const context = { ownerId: 'owner', identityVersion: 8, eventId: 'a6200000-0000-4000-8000-000000000001', sourceKind: 'free_registration', search: '', setSearch: vi.fn(), event: { title: 'Community supper', artwork_path: null, admission_type: 'free', status: 'published', starts_at: '2026-09-14T12:00:00Z', ends_at: '2126-09-14T15:00:00Z' } }
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/organizer/events/a6200000-0000-4000-8000-000000000001/check-in/scan']}><Routes><Route path='/organizer/events/:eventId/check-in' element={<Outlet context={context} />}><Route path='scan' element={<OperationalScanner admissionChecker={checker} cameraDecoder={camera} />} /></Route></Routes></MemoryRouter></QueryClientProvider>)
  await screen.findByText('Scan guest ticket')
  expect(useEventMetrics).not.toHaveBeenCalled()
  expect(useOperationsMetrics).toHaveBeenCalledWith('owner', context.eventId, 'free_registration', 8)
})

it('stops the camera when switching a free event to manual guest search', async () => {
  useSession.mockReturnValue({ status: 'authenticated', identityVersion: 8, user: { id: 'owner' } })
  useOperationsMetrics.mockReturnValue({ data: { eventId: 'a6200000-0000-4000-8000-000000000001', checkedIn: 0, issued: 3 }, isPending: false, isError: false })
  const camera: CameraDecoder = { start: vi.fn<CameraDecoder['start']>(async () => ({ kind: 'permission_denied' })), stop: vi.fn() }
  const context = { ownerId: 'owner', identityVersion: 8, eventId: 'a6200000-0000-4000-8000-000000000001', sourceKind: 'free_registration', search: '', setSearch: vi.fn(), event: { title: 'Community supper', artwork_path: null, admission_type: 'free', status: 'published', starts_at: '2026-09-14T12:00:00Z', ends_at: '2126-09-14T15:00:00Z' } }
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[`/organizer/events/${context.eventId}/check-in/scan`]}><Routes><Route path='/organizer/events/:eventId/check-in' element={<Outlet context={context} />}><Route path='scan' element={<OperationalScanner admissionChecker={{ checkAdmission: vi.fn() }} cameraDecoder={camera} />} /><Route path='find' element={<p>Manual search for Community supper</p>} /></Route></Routes></MemoryRouter></QueryClientProvider>)
  await screen.findByRole('heading', { name: 'Camera permission denied' })
  await userEvent.click(screen.getByRole('link', { name: 'Find guest' }))
  expect(await screen.findByText('Manual search for Community supper')).toBeVisible()
  expect(camera.stop).toHaveBeenCalled()
})
it('keeps the canonical cancellation result visible when refreshed event rules close admission', async () => {
  useSession.mockReturnValue({ status: 'authenticated', user: { id: 'owner' } })
  let decode: ((value: string) => void) | undefined
  const camera: CameraDecoder = { start: vi.fn<CameraDecoder['start']>(async input => { decode = input.onDecode; return { kind: 'ready' } }), stop: vi.fn() }
  const data = { admissionEligible: true, event: { title: 'Sunset', artworkPath: null }, checkedIn: 0, issued: 3 }
  useEventMetrics.mockReturnValue({ data, isPending: false, isError: false })
  const checker = { checkAdmission: vi.fn(async () => ({ outcome: 'cancelled' as const, admissionLabel: 'VIP', attendeeLabel: 'Alex Chen' })) }
  const client = new QueryClient()
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/organizer/events/event/check-in']}><Routes><Route path='/organizer/events/:eventId/check-in' element={<OperationalScanner admissionChecker={checker} cameraDecoder={camera} />} /></Routes></MemoryRouter></QueryClientProvider>
  const view = render(tree())
  await screen.findByText('Scan guest ticket')
  act(() => decode?.('opaque-fixture'))
  await screen.findByRole('heading', { name: 'Ticket cancelled' })
  useEventMetrics.mockReturnValue({ data: { ...data, admissionEligible: false }, isPending: false, isError: false })
  view.rerender(tree())
  expect(screen.getByRole('heading', { name: 'Ticket cancelled' })).toBeVisible()
  expect(screen.getByText('Alex Chen')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Scan next ticket' })).not.toBeInTheDocument()
  expect(screen.getByText('Check-in closed')).toBeVisible()
  useSession.mockReturnValue({ status: 'authenticated', user: { id: 'different-owner' } })
  view.rerender(tree())
  expect(screen.queryByText('Alex Chen')).not.toBeInTheDocument()
})

it.each(['pending', 'network_error', 'admitted'] as const)('retains %s across background metrics failure and recovery', async outcome => {
  useSession.mockReturnValue({ status: 'authenticated', user: { id: 'owner' } })
  let decode: ((value: string) => void) | undefined
  const camera: CameraDecoder = { start: vi.fn<CameraDecoder['start']>(async input => { decode = input.onDecode; return { kind: 'ready' } }), stop: vi.fn() }
  const data = { admissionEligible: true, event: { title: 'Sunset', artworkPath: null }, checkedIn: 0, issued: 3 }
  useEventMetrics.mockReturnValue({ data, isPending: false, isError: false })
  const checker = { checkAdmission: vi.fn(() => outcome === 'pending' ? new Promise<never>(() => {}) : Promise.resolve({ outcome })) }
  const client = new QueryClient()
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/organizer/events/event/check-in']}><Routes><Route path='/organizer/events/:eventId/check-in' element={<OperationalScanner admissionChecker={checker} cameraDecoder={camera} />} /></Routes></MemoryRouter></QueryClientProvider>
  const view = render(tree())
  await screen.findByText('Scan guest ticket')
  act(() => decode?.('same-private-credential'))
  const heading = outcome === 'pending' ? 'Checking ticket' : outcome === 'admitted' ? 'Admitted' : 'Network error'
  await screen.findByRole('heading', { name: heading })
  useEventMetrics.mockReturnValue({ data, isPending: false, isError: true, error: new Error('offline'), refetch: vi.fn() })
  view.rerender(tree())
  expect(screen.getByRole('heading', { name: heading })).toBeVisible()
  useEventMetrics.mockReturnValue({ data, isPending: false, isError: false })
  view.rerender(tree())
  expect(screen.getByRole('heading', { name: heading })).toBeVisible()
  expect(camera.start).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('link', { name: 'Find guest' })).toHaveAttribute('href', '/organizer/events/event/check-in/find')
})

it('clears a previous result on scan next before a later event closure', async () => {
  useSession.mockReturnValue({ status: 'authenticated', user: { id: 'owner' } })
  let decode: ((value: string) => void) | undefined
  const camera: CameraDecoder = { start: vi.fn<CameraDecoder['start']>(async input => { decode = input.onDecode; return { kind: 'ready' } }), stop: vi.fn() }
  const data = { admissionEligible: true, event: { title: 'Sunset', artworkPath: null }, checkedIn: 0, issued: 3 }
  useEventMetrics.mockReturnValue({ data, isPending: false, isError: false })
  const checker = { checkAdmission: vi.fn(async () => ({ outcome: 'admitted' as const, attendeeLabel: 'Previous guest' })) }
  const client = new QueryClient()
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/organizer/events/event/check-in']}><Routes><Route path='/organizer/events/:eventId/check-in' element={<OperationalScanner admissionChecker={checker} cameraDecoder={camera} />} /></Routes></MemoryRouter></QueryClientProvider>
  const view = render(tree())
  await screen.findByText('Scan guest ticket')
  act(() => decode?.('private-credential'))
  await screen.findByText('Previous guest')
  await userEvent.click(screen.getByRole('button', { name: 'Scan next ticket' }))
  useEventMetrics.mockReturnValue({ data: { ...data, admissionEligible: false }, isPending: false, isError: false })
  view.rerender(tree())
  expect(screen.queryByText('Previous guest')).not.toBeInTheDocument()
})

it('aborts an old owner generation and never restores its late result after A-B-A', async () => {
  useSession.mockReturnValue({ status: 'authenticated', user: { id: 'owner-a' } })
  let decode: ((value: string) => void) | undefined
  const camera: CameraDecoder = { start: vi.fn<CameraDecoder['start']>(async input => { decode = input.onDecode; return { kind: 'ready' } }), stop: vi.fn() }
  const data = { admissionEligible: true, event: { title: 'Sunset', artworkPath: null }, checkedIn: 0, issued: 3 }
  useEventMetrics.mockReturnValue({ data, isPending: false, isError: false })
  let finish!: (value: { outcome: 'admitted'; attendeeLabel: string }) => void
  let signal: AbortSignal | undefined
  const checker = { checkAdmission: vi.fn((input: { signal?: AbortSignal }) => { signal = input.signal; return new Promise<{ outcome: 'admitted'; attendeeLabel: string }>(resolve => { finish = resolve }) }) }
  const client = new QueryClient()
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/organizer/events/event/check-in']}><Routes><Route path='/organizer/events/:eventId/check-in' element={<OperationalScanner admissionChecker={checker} cameraDecoder={camera} />} /></Routes></MemoryRouter></QueryClientProvider>
  const view = render(tree())
  await screen.findByText('Scan guest ticket')
  act(() => decode?.('private-credential'))
  await screen.findByText('Checking ticket')
  useSession.mockReturnValue({ status: 'authenticated', user: { id: 'owner-b' } })
  view.rerender(tree())
  expect(signal?.aborted).toBe(true)
  useSession.mockReturnValue({ status: 'authenticated', user: { id: 'owner-a' } })
  view.rerender(tree())
  await screen.findByText('Scan guest ticket')
  await act(async () => finish({ outcome: 'admitted', attendeeLabel: 'Stale guest' }))
  useEventMetrics.mockReturnValue({ data: { ...data, admissionEligible: false }, isPending: false, isError: false })
  view.rerender(tree())
  expect(screen.queryByText('Stale guest')).not.toBeInTheDocument()
  useEventMetrics.mockReturnValue({ data, isPending: false, isError: true, error: new OperationsReadError('denied', true), refetch: vi.fn() })
  view.rerender(tree())
  expect(screen.getByText('Check-in unavailable')).toBeVisible()
  expect(screen.queryByLabelText('Camera preview')).not.toBeInTheDocument()
})

it('Spec10 event session removal through Spec11 cleanup tears down active scanner and ignores late admission', async () => {
 useSession.mockReturnValue({ status: 'authenticated', user: { id: 'owner' } })
 const client = new QueryClient()
 let decode: ((value: string) => void) | undefined
 let finish!: (value: { outcome: 'admitted'; attendeeLabel: string }) => void
 let signal: AbortSignal | undefined
 const camera: CameraDecoder = { start: vi.fn<CameraDecoder['start']>(async input => { decode = input.onDecode; return { kind: 'ready' } }), stop: vi.fn() }
 useEventMetrics.mockReturnValue({ data: { admissionEligible: true, event: { title: 'Integration event', artworkPath: null }, checkedIn: 0, issued: 3 }, isPending: false, isError: false })
 const checker = { checkAdmission: vi.fn((input: { signal?: AbortSignal }) => { signal = input.signal; return new Promise<{ outcome: 'admitted'; attendeeLabel: string }>(resolve => { finish = resolve }) }) }
 const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/organizer/events/event/check-in']}><Routes><Route path='/organizer/events/:eventId/check-in' element={<OperationalScanner admissionChecker={checker} cameraDecoder={camera} />} /></Routes></MemoryRouter></QueryClientProvider>
 const view = render(tree()); await screen.findByText('Scan guest ticket'); act(() => decode?.('synthetic-credential')); await screen.findByText('Checking ticket')
 const { evictPrivateIdentityQueries } = await import('../auth/privateQueryCache')
 act(() => evictPrivateIdentityQueries(client))
 useSession.mockReturnValue({ status: 'anonymous', user: null }); view.rerender(tree())
 expect(signal?.aborted).toBe(true); expect(camera.stop).toHaveBeenCalled(); expect(screen.queryByLabelText('Camera preview')).not.toBeInTheDocument()
 await act(async () => finish({ outcome: 'admitted', attendeeLabel: 'Late private attendee' }))
 expect(screen.queryByText('Late private attendee')).not.toBeInTheDocument()
 expect(client.getQueryData(['organizer-operations', 'owner', 'event'])).toBeUndefined()
})
