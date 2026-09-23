import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { payload, event } from '../../test/exportFixtures'
import { invalidateIdentityLifetime } from '../auth/identityLifetime'
const { read, download, session } = vi.hoisted(() => ({ read: vi.fn(), download: vi.fn(), session: { status: 'authenticated', user: { id: 'owner' }, identityVersion: 0 } }))
vi.mock('./export.api', () => ({ getEventExport: read }))
vi.mock('./export.csv', async original => ({ ...await original<typeof import('./export.csv')>(), downloadExport: download }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => session }))
import { EventExportControl } from './EventExportControl'
import { exportSchema } from './export.schemas'
import { ExportError } from './export.csv'
function show(source: 'paid' | 'free' = 'paid', status: 'published' | 'draft' = 'published') {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  return { ...render(<EventExportControl eventId={event.id} source={source} eventStatus={status} />, { wrapper }), client }
}
beforeEach(() => { vi.clearAllMocks(); session.status = 'authenticated'; session.identityVersion = 0; read.mockResolvedValue(exportSchema.parse(payload)) })
function start() { fireEvent.click(screen.getByRole('button', { name: 'Export' })); fireEvent.click(screen.getByRole('button', { name: 'Orders CSV' })) }
it('shows paid choices and all-event scope; downloads once and reports initiation', async () => {
  show(); start()
  await waitFor(() => expect(download).toHaveBeenCalledOnce())
  expect(screen.getByText('Download started.')).toBeVisible()
  expect(screen.getByText('Exports all records for this event. Search and filters do not apply.')).toBeVisible()
  expect(download.mock.calls[0][1]).toBe('r-b-fridays-2026-10-09-orders.csv')
})
it('prevents concurrent duplicate requests', async () => {
  read.mockReturnValue(new Promise(() => {})); show(); start()
  expect(screen.getByText('Preparing CSV…')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Orders CSV' }))
  expect(read).toHaveBeenCalledOnce()
})
it('offers only registration export for free events and hides drafts', () => {
  const view = show('free')
  expect(screen.getByRole('button', { name: 'Export Registrations CSV' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
  view.unmount(); show('paid', 'draft'); expect(screen.queryByRole('button')).toBeNull()
})
it('produces a header-only download for empty data', async () => {
  read.mockResolvedValue(exportSchema.parse({ ...payload, rows: [], rowCount: 0 })); show(); start()
  expect(await screen.findByText('No records yet.')).toBeVisible(); expect(download).toHaveBeenCalledOnce()
})
it('shows oversized failure with no download and supports retry', async () => {
  read.mockRejectedValueOnce(new ExportError('limit')); show(); start()
  expect(await screen.findByRole('alert')).toHaveTextContent('download limit')
  expect(download).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(download).toHaveBeenCalledOnce())
})
it.each(['unmount','event','logout','lifetime'] as const)('discards late data after %s', async change => {
  let resolve!: (value: unknown) => void
  read.mockReturnValue(new Promise(value => { resolve = value }))
  const view = show(); start()
  if (change === 'unmount') view.unmount()
  if (change === 'event') view.rerender(<EventExportControl eventId='a6200000-0000-4000-8000-000000000002' source='paid' eventStatus='published' />)
  if (change === 'logout') { session.status = 'anonymous'; view.rerender(<EventExportControl eventId={event.id} source='paid' eventStatus='published' />) }
  if (change === 'lifetime') invalidateIdentityLifetime(view.client)
  await act(async () => resolve(exportSchema.parse(payload)))
  expect(download).not.toHaveBeenCalled()
})
it.each(['source','identity'] as const)('aborts and discards pending data on %s change', async change => {
  let resolve!: (value: unknown) => void
  read.mockReturnValue(new Promise(value => { resolve = value }))
  const view = show(); start()
  const signal = read.mock.calls[0][2] as AbortSignal
  if (change === 'identity') session.identityVersion += 1
  view.rerender(<EventExportControl eventId={event.id} source={change === 'source' ? 'free' : 'paid'} eventStatus='published' />)
  expect(signal.aborted).toBe(true)
  await act(async () => resolve(exportSchema.parse(payload)))
  expect(download).not.toHaveBeenCalled()
})
it('expires at 30 seconds, aborts transport and ignores its late result', async () => {
  vi.useFakeTimers()
  try {
    let resolve!: (value: unknown) => void
    read.mockReturnValue(new Promise(value => { resolve = value }))
    show(); start()
    const signal = read.mock.calls[0][2] as AbortSignal
    await act(async () => { vi.advanceTimersByTime(30000) })
    expect(signal.aborted).toBe(true)
    expect(screen.getByRole('alert')).toHaveTextContent('could not be prepared')
    await act(async () => resolve(exportSchema.parse(payload)))
    expect(download).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
