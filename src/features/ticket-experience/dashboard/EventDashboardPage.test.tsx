import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type {
  EventDashboardReader,
  EventDashboardResult,
} from '../contracts/dashboard'
import { EventDashboardPage } from './EventDashboardPage'

const dashboardFixture: EventDashboardResult = {
  kind: 'ready',
  dashboard: {
    eventId: 'event-a',
    eventName: 'Mission Night Market',
    eventStatus: 'Upcoming',
    startsAt: '2026-09-12T18:00:00-07:00',
    ticketUnitsSold: 12,
    checkedIn: 4,
    remaining: 8,
    grossSales: { amountMinor: 48000, currency: 'USD' },
    dataDisclosure: 'Demo data',
    manageEventPath: '/organizer/events/event-a',
  },
}

function readerReturning(result: EventDashboardResult): EventDashboardReader {
  return { readDashboard: vi.fn(async () => result) }
}

function renderDashboard(input: { reader: EventDashboardReader; eventId?: string }) {
  const eventId = input.eventId ?? 'event-a'
  return render(
    <MemoryRouter initialEntries={[`/organizer/events/${eventId}/dashboard`]}>
      <Routes>
        <Route
          path="/organizer/events/:eventId/dashboard"
          element={<EventDashboardPage reader={input.reader} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('EventDashboardPage', () => {
  it('renders only supplied event projections and approved actions', async () => {
    const inconsistentProjection: EventDashboardResult = dashboardFixture.kind === 'ready'
      ? {
          ...dashboardFixture,
          dashboard: {
            ...dashboardFixture.dashboard,
            remaining: 19,
          },
        }
      : dashboardFixture

    renderDashboard({ reader: readerReturning(inconsistentProjection) })

    expect(await screen.findByRole('heading', { name: 'Mission Night Market' })).toBeVisible()
    expect(screen.getByText('Demo data')).toBeVisible()
    expect(screen.getByText('Upcoming')).toBeVisible()
    expect(screen.getByText('Saturday, September 12, 2026 at 6:00 PM')).toBeVisible()
    expect(screen.getByText('12')).toBeVisible()
    expect(screen.getByText('4')).toBeVisible()
    expect(screen.getByText('19')).toBeVisible()
    expect(screen.getByText('$480.00')).toBeVisible()
    expect(screen.getByText('Ticket units sold')).toBeVisible()
    expect(screen.queryByText(/orders?/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Check in guests' })).toHaveAttribute(
      'href',
      '/organizer/events/event-a/check-in',
    )
    expect(screen.getByRole('link', { name: 'Manage event' })).toHaveAttribute(
      'href',
      '/organizer/events/event-a',
    )
    expect(screen.getByRole('button', { name: 'View attendees — Coming later' })).toBeDisabled()
    expect(screen.queryByText(/chart|payout|conversion|traffic/i)).not.toBeInTheDocument()
  })

  it('shows loading, passes the event id and abort signal, and replaces loading with data', async () => {
    let resolve!: (result: EventDashboardResult) => void
    const readDashboard = vi.fn<EventDashboardReader['readDashboard']>(
      () => new Promise((done) => { resolve = done }),
    )
    renderDashboard({ reader: { readDashboard }, eventId: 'event-b' })

    expect(screen.getByText('Loading event dashboard')).toBeVisible()
    expect(readDashboard).toHaveBeenCalledWith({
      eventId: 'event-b',
      signal: expect.any(AbortSignal),
    })

    const eventBResult: EventDashboardResult = dashboardFixture.kind === 'ready'
      ? {
          kind: 'ready',
          dashboard: {
            ...dashboardFixture.dashboard,
            eventId: 'event-b',
          },
        }
      : dashboardFixture
    await act(async () => resolve(eventBResult))
    expect(await screen.findByRole('heading', { name: 'Mission Night Market' })).toBeVisible()
  })

  it('fails closed when an adapter returns a projection for another event', async () => {
    renderDashboard({ reader: readerReturning(dashboardFixture), eventId: 'event-b' })

    expect(await screen.findByRole('alert')).toHaveTextContent('Event dashboard unavailable')
    expect(screen.queryByText('Mission Night Market')).not.toBeInTheDocument()
    expect(screen.queryByText('Demo data')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Check in guests' })).not.toBeInTheDocument()
  })

  it('does not create a nested main landmark inside the organizer shell', async () => {
    const view = render(
      <main className="organizer-layout__main">
        <MemoryRouter initialEntries={['/organizer/events/event-a/dashboard']}>
          <Routes>
            <Route
              path="/organizer/events/:eventId/dashboard"
              element={<EventDashboardPage reader={readerReturning(dashboardFixture)} />}
            />
          </Routes>
        </MemoryRouter>
      </main>,
    )

    expect(await screen.findByRole('heading', { name: 'Mission Night Market' })).toBeVisible()
    expect(view.container.querySelectorAll('main')).toHaveLength(1)
  })

  it('shows a safe error and retries the reader', async () => {
    const user = userEvent.setup()
    const readDashboard = vi.fn<EventDashboardReader['readDashboard']>()
      .mockRejectedValueOnce(new Error('private provider response'))
      .mockResolvedValueOnce(dashboardFixture)
    renderDashboard({ reader: { readDashboard } })

    expect(await screen.findByRole('alert')).toHaveTextContent('Event dashboard unavailable')
    expect(screen.queryByText('private provider response')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: 'Mission Night Market' })).toBeVisible()
    expect(readDashboard).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{ kind: 'unavailable' }, 'Event dashboard unavailable'],
    [{ kind: 'not_enabled' }, 'Event dashboard not enabled'],
  ] as const)('fails closed without demo metrics for $kind', async (result, heading) => {
    renderDashboard({ reader: readerReturning(result) })

    expect(await screen.findByText(heading)).toBeVisible()
    expect(screen.queryByText('Demo data')).not.toBeInTheDocument()
    expect(screen.queryByText('Ticket units sold')).not.toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('aborts an in-flight read when the page unmounts', () => {
    let signal: AbortSignal | undefined
    const reader: EventDashboardReader = {
      readDashboard: vi.fn(({ signal: nextSignal }): Promise<EventDashboardResult> => {
        signal = nextSignal
        return new Promise(() => {})
      }),
    }
    const view = renderDashboard({ reader })

    view.unmount()
    expect(signal?.aborted).toBe(true)
  })
})
it('opens email attendees for this event', async () => {
  renderDashboard({ reader: readerReturning(dashboardFixture) })
  expect(await screen.findByRole('link', { name: 'Email Attendees' })).toHaveAttribute('href', '/organizer/events/event-a/email-attendees')
})
