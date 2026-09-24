import { useWaitlistCapability } from '../waitlist/waitlist.queries'
import { WaitlistJoinForm } from '../waitlist/WaitlistJoinForm'
import { usePublicEventImages } from '../event-images/publicEventImages'
import '../buyer-journey/buyer-availability.css'
import { discoveryReturnPath } from '../discovery/discovery.navigation'
import { FreeRsvpEntry } from '../rsvp/FreeRsvpEntry'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { BuyerHeader, BuyerIcon } from '../buyer-journey/BuyerPrimitives'
import { EventPageView } from '../buyer-journey/EventPageView'
import type { AsyncStatus } from '../../components/ui/AsyncState'
import { ReadState } from '../../components/ui/ReadState'
import { Button } from '../../components/ui/Button'
import { ReportEventDialog } from '../moderation/ReportEventDialog'
import { encodeCheckoutCart, parseCheckoutCart, MAX_CHECKOUT_QUANTITY } from '../checkout/checkout.cart'
import { TicketTierList } from './TicketTierList'
import { isRetryablePublicTicketingError } from './publicTicketing.errors'
import { usePublicTicketingEvent } from './publicTicketing.queries'
import type { CanonicalPublicTicketingEvent, PublicTicketTierTuple } from './ticket.types'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: 'numeric',
  minute: '2-digit',
})

function formatDateAndTime(startsAt: string, endsAt: string): { date: string; time: string } {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { date: 'Date unavailable', time: 'Time unavailable' }
  }

  const startDate = dateFormatter.format(start)
  const endDate = dateFormatter.format(end)

  return {
    date: startDate === endDate ? startDate : `${startDate} – ${endDate}`,
    time: `${timeFormatter.format(start)}–${timeFormatter.format(end)} PT`,
  }
}

function formatAddress(event: {
  address_line1: string
  address_line2: string | null
  city: string
  region: 'CA'
  postal_code: string
}): string {
  const street = [event.address_line1, event.address_line2].filter(Boolean).join(', ')
  return `${street}, ${event.city}, ${event.region} ${event.postal_code}`
}

type PublicEventStateProps = {
  paused?: boolean
  action?: ReactNode
  description?: string
  status: AsyncStatus
  title: string
}

function PublicEventState({ action, description, status, title, paused }: PublicEventStateProps) {
  return (
    <main className="buyer-page buyer-state">
      <BuyerHeader back={<Link className="buyer-icon-button" aria-label="Browse events" to="/discover"><BuyerIcon name="back" /></Link>} />
      <ReadState paused={paused} headingAs="h1" skeleton="detail-fields" action={action} description={description} status={status} title={title} />
    </main>
  )
}

type PublicTicketPurchaseProps = {
  eventId: string
  tiers: PublicTicketTierTuple
  availabilityKnown: boolean
  startsAt: string
  refresh: () => Promise<unknown>
}

function PublicTicketPurchase({ eventId, tiers, availabilityKnown, startsAt, refresh }: PublicTicketPurchaseProps) {
  const capability=useWaitlistCapability(eventId)
  const [joinTier,setJoinTier]=useState<string|null>(null)
  const [waitlistNotice,setWaitlistNotice]=useState('')
  const focusTier=useRef<string|null>(null)
  const [focusRequest,setFocusRequest]=useState(0)
  useEffect(()=>{if(!focusTier.current)return;const input=document.getElementById(`ticket-quantity-${focusTier.current}`);if(input instanceof HTMLInputElement&&!input.disabled){input.focus();focusTier.current=null}},[tiers,availabilityKnown,focusRequest])
  const [now,setNow]=useState(()=>Date.now())
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  const canJoin=availabilityKnown&&!capability.isError&&capability.data?.enabled&&capability.data.eligible&&now<Date.parse(startsAt)
  async function reopened(id:string){setJoinTier(null);setWaitlistNotice('Checking ticket availability…');try{const result=await refresh() as {isError?:boolean};if(result?.isError)throw Error();setWaitlistNotice('Ticket availability refreshed. Review the current selection.');focusTier.current=id;setFocusRequest(value=>value+1)}catch{focusTier.current=null;setWaitlistNotice('Could not refresh ticket availability. Please check again before purchasing.')}}
  const navigate = useNavigate()
  const location = useLocation()
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries((parseCheckoutCart(location.search) ?? []).map(item => [item.tierId, item.quantity])))
  const facts = Object.fromEntries(tiers.map(tier => [tier.id, tier]))
  const factsKey = tiers.map(tier => `${tier.id}:${tier.availability_status}:${tier.unit_amount_minor}`).sort().join('|')
  const [previous, setPrevious] = useState({ key: factsKey, known: availabilityKnown, facts })
  const [needsReview, setNeedsReview] = useState(false)
  const [priceReviewIds, setPriceReviewIds] = useState<string[]>([])
  const [knownNames, setKnownNames] = useState<Record<string, string>>(() => Object.fromEntries(tiers.map(t => [t.id, t.name])))
  if (previous.key !== factsKey || previous.known !== availabilityKnown) {
    // Preserve the entire draft. A refresh must never silently remove a purchase line
    // or accept a changed price on the buyer's behalf.
    const changed = Object.entries(quantities).some(([id, quantity]) => quantity > 0 && (
      previous.facts[id]?.availability_status !== facts[id]?.availability_status
      || previous.facts[id]?.unit_amount_minor !== facts[id]?.unit_amount_minor
      || previous.known !== availabilityKnown
    ))
    if (changed) setNeedsReview(true)
    const changedPrices = Object.entries(quantities).filter(([id, quantity]) => quantity > 0 && previous.facts[id] && facts[id]
      && previous.facts[id].unit_amount_minor !== facts[id].unit_amount_minor).map(([id]) => id)
    if (changedPrices.length) setPriceReviewIds(current => [...new Set([...current, ...changedPrices])])
    setPrevious({ key: factsKey, known: availabilityKnown, facts })
    setKnownNames(current => ({ ...current, ...Object.fromEntries(tiers.map(t => [t.id, t.name])) }))
  }
  const items = Object.entries(quantities).filter(([, quantity]) => quantity > 0)
    .map(([tierId, quantity]) => ({ tierId, quantity }))
  const unavailableItems = items.filter(item => facts[item.tierId]?.availability_status !== 'available')
  const hasInvalidQuantity = Object.values(quantities).some(quantity =>
    !Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_CHECKOUT_QUANTITY)
  const total = items.reduce((sum, item) => sum + item.quantity, 0)
  const validCart = !hasInvalidQuantity && items.length > 0 && total <= MAX_CHECKOUT_QUANTITY
  const allSoldOut = availabilityKnown && tiers.length > 0 && tiers.every(t => t.availability_status === 'sold_out')
  const hasAvailableTier = availabilityKnown && tiers.some(t => t.availability_status === 'available')
  const canContinue = availabilityKnown && validCart && unavailableItems.length === 0 && !needsReview

  function saveQuantities(next: Record<string, number>) {
    setQuantities(next)
    const selected = Object.entries(next).filter(([, quantity]) => quantity > 0).map(([tierId, quantity]) => ({ tierId, quantity }))
    if (Object.values(next).every(q => Number.isSafeInteger(q) && q >= 0 && q <= MAX_CHECKOUT_QUANTITY)
      && selected.reduce((sum, item) => sum + item.quantity, 0) <= MAX_CHECKOUT_QUANTITY) {
      navigate({ pathname: location.pathname, search: selected.length ? `?${encodeCheckoutCart(selected)}` : '' }, { replace: true })
    }
  }

  return (
    <section aria-labelledby="public-event-tickets" className="public-event__tickets">
      <div>
        <p className="public-event__eyebrow">Tickets</p>
        <h2 id="public-event-tickets">{allSoldOut ? 'This event is sold out' : !hasAvailableTier ? 'Tickets unavailable' : 'Choose your tickets'}</h2>
        {allSoldOut ? <p>All ticket types are sold out.</p> : !hasAvailableTier ? <p>We cannot offer tickets for this event right now.</p> : null}
      </div>
      <TicketTierList maxTotal={MAX_CHECKOUT_QUANTITY} onQuantityChange={(id, quantity) => saveQuantities({ ...quantities, [id]: quantity })}
        quantities={quantities} tiers={tiers} availabilityKnown={availabilityKnown}
        renderWaitlist={canJoin?(id)=>joinTier===id?<WaitlistJoinForm key={id} eventId={eventId} tierId={id} tierName={tiers.find(t=>t.id===id)?.name??'this tier'} onAvailable={()=>reopened(id)} onCancel={()=>{setJoinTier(null);requestAnimationFrame(()=>document.getElementById(`waitlist-join-${id}`)?.focus())}}/>:<button id={`waitlist-join-${id}`} type='button' className='ui-button ui-button--secondary' onClick={()=>setJoinTier(id)}>Join Waitlist</button>:undefined} />
      {waitlistNotice&&<p role='status'>{waitlistNotice}</p>}
      {unavailableItems.length > 0 ? <div className="buyer-availability-review" role="status">
        <p>These tickets are no longer available in your selection:</p>
        <ul>{unavailableItems.map(item => <li key={item.tierId}>{knownNames[item.tierId] ?? 'Unavailable ticket'} × {item.quantity}</li>)}</ul>
        <Button disabled={!availabilityKnown} onClick={() => {
          saveQuantities(Object.fromEntries(Object.entries(quantities).filter(([id]) => facts[id]?.availability_status === 'available')))
          setNeedsReview(priceReviewIds.some(id => quantities[id] > 0 && facts[id]?.availability_status === 'available'))
        }}>Remove unavailable tickets</Button>
      </div> : needsReview ? <div className="buyer-availability-review" role="status">
        <p>Your selected tickets have changed. Review the current availability and prices before continuing.</p>
        <Button disabled={!availabilityKnown} onClick={() => { setNeedsReview(false); setPriceReviewIds([]) }}>Confirm updated selection</Button>
      </div> : null}
      <Button disabled={!canContinue} onClick={() => {
        if (canContinue) navigate({ pathname: `/events/${eventId}/checkout`, search: `?${encodeCheckoutCart(items)}` })
      }}>{allSoldOut ? 'Sold out' : !hasAvailableTier ? 'Tickets unavailable' : 'Continue to checkout'}</Button>
    </section>
  )
}

export function PublicTicketEventPage({ selection = false }: { selection?: boolean }) {
  const { eventId = '' } = useParams()
  const location = useLocation()
  const discoveryPath = discoveryReturnPath(location.state)
  const publicReturnState = { discoverySearch: discoveryPath.slice('/discover'.length) }
  const eventQuery = usePublicTicketingEvent(eventId)
  const images = usePublicEventImages(eventQuery.data ? [eventId] : [])
  const hasRetryableStaleEvent = eventQuery.isError
    && eventQuery.data !== undefined
    && eventQuery.data !== null
    && isRetryablePublicTicketingError(eventQuery.error)

  if ((eventQuery.isPending || eventQuery.data === undefined) && !eventQuery.isError) {
    return <PublicEventState paused={eventQuery.fetchStatus === 'paused'} status="loading" title="Loading event" />
  }
  if (eventQuery.isError && !hasRetryableStaleEvent) {
    return <PublicEventState action={<Button onClick={() => void eventQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="error" title="Event could not load" />
  }
  if (eventQuery.data === null) {
    return <PublicEventState description="This event may no longer be available." status="not-found" title="Event not found" />
  }

  const publicEvent = eventQuery.data
  const { event } = publicEvent
  const paidPublicEvent = publicEvent.event.admission_type === 'paid'
    ? publicEvent as Extract<CanonicalPublicTicketingEvent, { event: { admission_type: 'paid' } }>
    : null
  const dateAndTime = formatDateAndTime(event.starts_at, event.ends_at)

  const artwork = images.data?.find(image => image.position === 1)?.url ?? null
  const paidAvailable = !hasRetryableStaleEvent && paidPublicEvent?.tiers.some(tier => tier.availability_status === 'available')
  const compactAvailability = paidPublicEvent !== null && !paidAvailable

  return (
    <div className={compactAvailability ? "buyer-availability" : undefined}>
      {hasRetryableStaleEvent ? (
        <div className="public-event-refresh" role="status">
          <p>Showing the last event details we received. We could not check current availability.</p>
          <Button onClick={() => void eventQuery.refetch()}>Check again</Button>
        </div>
      ) : null}
      <EventPageView title={event.title} organizer={event.organizer.display_name}
        date={dateAndTime.date} time={dateAndTime.time} venue={event.venue_name ?? 'Venue to be announced'}
        location={formatAddress(event)} description={event.description} artwork={artwork} selection={selection}
        back={<Link className="buyer-icon-button" aria-label={selection ? 'Return to event' : 'Browse events'} to={selection ? `/events/${event.id}` : discoveryPath} state={selection ? publicReturnState : undefined}><BuyerIcon name="back" /></Link>}
        badge={event.admission_type==='free'?'Free RSVP':undefined}
        action={!selection && paidAvailable ? <Link className="ui-button buyer-primary" to={`/events/${event.id}/tickets`} state={publicReturnState}>Get tickets<BuyerIcon name="arrow" /></Link> : undefined}
      >
        {paidPublicEvent !== null ? <PublicTicketPurchase key={event.id} eventId={event.id} startsAt={event.starts_at} refresh={()=>eventQuery.refetch()} tiers={paidPublicEvent.tiers} availabilityKnown={!hasRetryableStaleEvent} /> : (
          <section className="public-event__tickets"><h2>Free RSVP</h2><p>No payment required.</p><FreeRsvpEntry eventId={event.id}/></section>
        )}
        {!hasRetryableStaleEvent ? <ReportEventDialog eventId={event.id} /> : null}
      </EventPageView>
    </div>
  )
}

export function PublicTicketSelectionPage() {
  return <PublicTicketEventPage selection />
}
