import { ReadState } from '../../components/ui/ReadState'
import { TicketDeliveryNotice } from '../ticket-delivery/TicketDeliveryNotice'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BuyerEventSummary, BuyerHeader } from '../buyer-journey/BuyerPrimitives'
import { downloadAdmissionCalendar } from '../buyer-journey/calendar'
import { formatBuyerSchedule } from '../buyer-journey/format'
import { createTicketCollectionReader } from '../ticket-experience/adapters/ticketCollectionReader'
import type { TicketCollectionResult } from '../ticket-experience/contracts/ticketCollection'
import { useTicketDocumentPrivacy } from '../ticket-experience/customer/useTicketDocumentPrivacy'
import { parseFreeLocator } from './rsvp.contract'
import { RsvpProgress } from './RsvpPage'
import '../buyer-journey/buyer-recovery.css'
import './rsvp.css'
const reader = createTicketCollectionReader()
export function RsvpConfirmationPage() {
  const { collectionBearer = '' } = useParams()
  return <PrivateRsvpConfirmation key={collectionBearer} collectionBearer={collectionBearer} />
}
function PrivateRsvpConfirmation({ collectionBearer }: { collectionBearer: string }) {
  useTicketDocumentPrivacy()
  const [now] = useState(() => Date.now())
  const [version, setVersion] = useState(0)
  const [loaded, setLoaded] = useState<
    { bearer: string; version: number; result: TicketCollectionResult } | null
  >(null)
  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(async () => {
      let result: TicketCollectionResult
      try {
        parseFreeLocator(collectionBearer)
        result = await reader.readCollection({ collectionBearer, signal: controller.signal })
      } catch {
        result = { kind: 'unavailable' }
      }
      if (!controller.signal.aborted) setLoaded({ bearer: collectionBearer, version, result })
    })
    return () => controller.abort()
  }, [collectionBearer, version])
  const result = loaded?.bearer === collectionBearer && loaded.version === version
    ? loaded.result
    : null
  const collection = result?.kind === 'ready' ? result.collection : null
  const first = collection?.tickets[0]
  const cancelled = collection?.registrationStatus === 'cancelled'
  const ended = first?.endsAt ? Date.parse(first.endsAt) <= now : false
  return (
    <main className={`buyer-page buyer-rsvp buyer-confirmation${collection ? cancelled ? ' buyer-confirmation--cancelled' : ended ? ' buyer-confirmation--expired' : ' buyer-confirmation--paid' : ''}`}>
      <BuyerHeader />
      <RsvpProgress step={3} />
      <div className='buyer-content'>
        {!result
          ? <ReadState headingAs='h1' status='loading' skeleton='detail-fields' title='Checking your private RSVP…' />
          : !collection || !first
          ? (
            <ReadState headingAs='h1' status='unavailable' title='Tickets unavailable'
              description='We could not load your private registration. Keep this link and check again.'
              action={<button className='ui-button buyer-primary' onClick={() => setVersion((v) => v + 1)}>Check again</button>} />
          )
          : (
            <>
              <header className='buyer-confirmation__success'>
                <span className='buyer-confirmation__seal' aria-hidden='true'>
                  {cancelled ? '×' : '✓'}
                </span>
                <h1>
                  {cancelled ? 'Event cancelled' : ended ? 'Event ended' : 'You’re on the list'}
                </h1>
                <p role='status'>
                  {cancelled
                    ? 'Unused tickets have been cancelled. Your check-in history is preserved.'
                    : ended
                    ? 'Your tickets remain available as a record of this event.'
                    : `${collection.tickets.length} admission${
                      collection.tickets.length === 1 ? '' : 's'
                    } confirmed`}
                </p>
              </header>
              <BuyerEventSummary
                title={first.eventName}
                schedule={formatBuyerSchedule(first.startsAt, first.endsAt, first.timezone)}
                venue={first.venueName}
              />
              <TicketDeliveryNotice collectionBearer={collectionBearer} />
              <p className='rsvp-notice'>
                Your tickets are available from this private link. Keep the link to return to them.
              </p>
              <Link className='ui-button buyer-primary' to={'/tickets/' + collectionBearer}>
                View {collection.tickets.length === 1 ? 'ticket' : 'tickets'}
              </Link>
              {!cancelled && !ended && first.startsAt !== null && first.endsAt !== null && (
                <button
                  className='ui-button buyer-secondary'
                  onClick={() =>
                    first.startsAt !== null && first.endsAt !== null && downloadAdmissionCalendar({
                      uid: 'rsvp-' + (collection.registrationId ?? first.selector),
                      title: first.eventName,
                      startsAt: first.startsAt,
                      endsAt: first.endsAt,
                      location: first.venueName,
                    })}
                >
                  Add to calendar
                </button>
              )}
            </>
          )}
        <Link className='ui-button buyer-secondary' to='/discover'>Browse events</Link>
      </div>
    </main>
  )
}
