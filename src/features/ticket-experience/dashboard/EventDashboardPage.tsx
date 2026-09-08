import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AsyncState } from '../../../components/ui/AsyncState'
import { Button } from '../../../components/ui/Button'
import type {
  EventDashboard,
  EventDashboardReader,
  EventDashboardResult,
} from '../contracts/dashboard'

type RequestKey = {
  eventId: string
  reader: EventDashboardReader
  requestVersion: number
}

type ReaderState = (
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'resolved'; result: EventDashboardResult }
) & { requestKey: RequestKey }

const eventDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatEventDate(value: string): string {
  const instant = new Date(value)
  return Number.isNaN(instant.getTime())
    ? 'Date and time unavailable'
    : eventDateFormatter.format(instant).replace(/ ([AP]M)$/, '\u00a0$1')
}

function formatMinorCurrency({ amountMinor, currency }: EventDashboard['grossSales']): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  })
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(amountMinor / (10 ** fractionDigits))
}

function DashboardState({ children }: { children: React.ReactNode }) {
  return <div className="event-dashboard event-dashboard--state">{children}</div>
}

export function EventDashboardPage({
  reader,
  scannerPathForEvent,
}: {
  reader: EventDashboardReader
  scannerPathForEvent?: (eventId: string) => string
}) {
  const { eventId = '' } = useParams()
  const [requestVersion, setRequestVersion] = useState(0)
  const requestKey = useMemo(
    () => ({ eventId, reader, requestVersion }),
    [eventId, reader, requestVersion],
  )
  const [storedReaderState, setReaderState] = useState<ReaderState>(() => ({
    kind: 'loading',
    requestKey,
  }))
  const readerState: ReaderState = storedReaderState.requestKey === requestKey
    ? storedReaderState
    : { kind: 'loading', requestKey }

  useEffect(() => {
    const controller = new AbortController()

    requestKey.reader.readDashboard({
      eventId: requestKey.eventId,
      signal: controller.signal,
    }).then(
      (result) => {
        if (!controller.signal.aborted) setReaderState({ kind: 'resolved', requestKey, result })
      },
      () => {
        if (!controller.signal.aborted) setReaderState({ kind: 'error', requestKey })
      },
    )

    return () => controller.abort()
  }, [requestKey])

  if (readerState.kind === 'loading') {
    return (
      <DashboardState>
        <AsyncState
          description="Getting the latest event-level view."
          status="loading"
          title="Loading event dashboard"
        />
      </DashboardState>
    )
  }

  if (readerState.kind === 'error') {
    return (
      <DashboardState>
        <AsyncState
          action={<Button onClick={() => setRequestVersion((version) => version + 1)}>Try again</Button>}
          description="Check your connection, then try again."
          status="error"
          title="Event dashboard unavailable"
        />
      </DashboardState>
    )
  }

  if (readerState.result.kind !== 'ready') {
    const isNotEnabled = readerState.result.kind === 'not_enabled'
    return (
      <DashboardState>
        <AsyncState
          description={isNotEnabled
            ? 'Event-level reporting has not been enabled for this event.'
            : 'Event-level reporting is temporarily unavailable.'}
          status={isNotEnabled ? 'empty' : 'error'}
          title={isNotEnabled ? 'Event dashboard not enabled' : 'Event dashboard unavailable'}
        />
      </DashboardState>
    )
  }

  const { dashboard } = readerState.result
  if (dashboard.eventId !== eventId) {
    return (
      <DashboardState>
        <AsyncState
          description="Event-level reporting is temporarily unavailable."
          status="error"
          title="Event dashboard unavailable"
        />
      </DashboardState>
    )
  }
  const scannerPath = scannerPathForEvent?.(eventId)
    ?? `/organizer/events/${encodeURIComponent(eventId)}/check-in`

  return (
    <div className="event-dashboard">
      <header className="event-dashboard__masthead">
        <div className="event-dashboard__masthead-topline">
          <p className="event-dashboard__eyebrow">Event command center</p>
          {dashboard.dataDisclosure
            ? <strong className="event-dashboard__disclosure">{dashboard.dataDisclosure}</strong>
            : null}
        </div>
        <div className="event-dashboard__title-row">
          <div>
            <h1>{dashboard.eventName}</h1>
            <p className="event-dashboard__date">{formatEventDate(dashboard.startsAt)}</p>
          </div>
          <strong className="event-dashboard__status">{dashboard.eventStatus}</strong>
        </div>
      </header>

      <section aria-labelledby="event-dashboard-metrics" className="event-dashboard__metrics">
        <div className="event-dashboard__section-heading">
          <p>Live operations</p>
          <h2 id="event-dashboard-metrics">At a glance</h2>
        </div>
        <dl className="event-dashboard__metric-list">
          <div>
            <dt>Ticket units sold</dt>
            <dd>{dashboard.ticketUnitsSold}</dd>
          </div>
          <div>
            <dt>Checked in</dt>
            <dd>{dashboard.checkedIn}</dd>
          </div>
          <div>
            <dt>Remaining</dt>
            <dd>{dashboard.remaining}</dd>
          </div>
          <div>
            <dt>Gross sales</dt>
            <dd>{formatMinorCurrency(dashboard.grossSales)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="event-dashboard-actions" className="event-dashboard__actions">
        <div className="event-dashboard__action-copy">
          <p>Next action</p>
          <h2 id="event-dashboard-actions">Run the door</h2>
          <p>Open this event’s scanner when your team is ready to admit guests.</p>
        </div>
        <div className="event-dashboard__action-list">
          <Link className="ui-button ui-button--primary" to={scannerPath}>Check in guests</Link>
          <Link className="ui-button ui-button--secondary" to={dashboard.manageEventPath}>Manage event</Link>
          <button
            aria-label="View attendees — Coming later"
            className="ui-button ui-button--secondary"
            disabled
            type="button"
          >
            View attendees — Coming later
          </button>
        </div>
      </section>
    </div>
  )
}
