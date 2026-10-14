import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('qrcode.react', () => ({ QRCodeCanvas: () => <canvas aria-label="Admission QR code" /> }))
vi.mock('./production', () => ({ productionTicketExperienceRuntime: {
  TicketCollectionRoute: () => <h1>Real accountless collection</h1>,
  OrganizerScannerRoute: () => <h1>Real organizer scanner</h1>,
} }))
import { developmentTicketExperienceRuntime } from './development'
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
function open(bearer: string) {
  const Collection = developmentTicketExperienceRuntime.TicketCollectionRoute
  return render(<MemoryRouter initialEntries={[`/tickets/${bearer}`]}><Routes><Route path="/tickets/:collectionBearer" element={<Collection />} /></Routes></MemoryRouter>)
}
it('delegates a real bearer to the production accountless collection route', () => {
  open('A'.repeat(43))
  expect(screen.getByRole('heading', { name: 'Real accountless collection' })).toBeVisible()
})
it('retains existing named synthetic previews', async () => {
  open('wh_test_collection_refunded')
  expect(screen.queryByText('Real accountless collection')).toBeNull()
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Refunded'))
  expect(screen.queryByRole('img', { name: 'Admission QR code' })).toBeNull()
})

it('keeps the valid synthetic ticket preview valid after its fixture date', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2030-01-01T12:00:00Z'))
  open('wh_test_collection_paid')

  expect(await screen.findByRole('heading', { name: 'Ticket 1' })).toBeVisible()
  expect(screen.getByTestId('admission-qr')).toBeVisible()
})

it('routes a real organizer event to the authenticated production scanner', () => {
  const Scanner = developmentTicketExperienceRuntime.OrganizerScannerRoute
  render(<MemoryRouter initialEntries={['/organizer/events/900a9142-9111-4f87-84d5-b8545a94c7fb/check-in']}><Routes><Route path="/organizer/events/:eventId/check-in" element={<Scanner />} /></Routes></MemoryRouter>)

  expect(screen.getByRole('heading', { name: 'Real organizer scanner' })).toBeVisible()
  expect(screen.queryByText('Development scenario unavailable')).not.toBeInTheDocument()
})

it('keeps the standalone development scanner restricted to named fixtures', () => {
  const route = developmentTicketExperienceRuntime.developmentRoutes.find(({ path }) => path === '/__dev/ticket-shells/events/:eventId/check-in')!
  const Scanner = route.Component!
  render(<MemoryRouter initialEntries={['/__dev/ticket-shells/events/900a9142-9111-4f87-84d5-b8545a94c7fb/check-in']}><Routes><Route path={route.path} element={<Scanner />} /></Routes></MemoryRouter>)

  expect(screen.getByText('Development scenario unavailable')).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Real organizer scanner' })).not.toBeInTheDocument()
})
