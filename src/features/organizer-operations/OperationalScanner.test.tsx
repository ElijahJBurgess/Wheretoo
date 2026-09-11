import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import type { CameraDecoder } from '../ticket-experience/scanner/scannerMachine'
const { useEventMetrics, useSession } = vi.hoisted(() => ({ useEventMetrics: vi.fn(), useSession: vi.fn() }))
vi.mock('./operations.queries', () => ({ useEventMetrics, operationsKeys: { event: () => ['organizer-operations', 'owner', 'event'] } }))
vi.mock('../auth/SessionProvider', () => ({ useSession }))
import { OperationalScanner } from './OperationalScanner'
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
