import { forwardRef, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePublicTicketingEvent } from '../../features/tickets/publicTicketing.queries'
import { EventDescription } from './EventDescription'
import type { WheretooMapEvent } from '../data/wheretooMapEvents'
import { formatEventDateTime, formatEventPrice, resolvePublicArtworkUrl } from './eventPreviewFormatting'
import type { EventPreviewNavigation } from './eventPreviewNavigation'

const categoryLabels = {
  food_drink: 'Food & drink', music: 'Music', fitness: 'Fitness', art_culture: 'Art & culture',
  shopping: 'Shopping', community: 'Community', nightlife: 'Nightlife', other: 'Around the city',
}

type EventPreviewCardProps = {
  event: WheretooMapEvent
  navigation: EventPreviewNavigation
  onOpenEvent?(to: string): void
  onClose(): void
  onBack?(): void
  /** URL from the canonical public event-image resolver; null means no public cover. */
  publicArtworkUrl?: string | null
}

function ArtworkFallback({ title }: { title: string }) {
  return (
    <span className="event-preview__artwork-fallback" aria-label="Event artwork unavailable">
      <span className="event-invitation__fallback-label">On the map. In real life.</span>
      <strong>{title}</strong>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3v3M17 3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
        <path d="m9.3 15.2 1.8 1.8 3.8-4.2" />
      </svg>
    </span>
  )
}

// One selected event uses the existing bounded, authoritative public read and
// query cache; bulk map queries never perform per-marker inventory reads.
function LivePaidAdmission({ event }: { event: WheretooMapEvent }) {
  const query = usePublicTicketingEvent(event.id)
  if (query.isFetching || query.isPending) return <>Checking availability…</>
  if (query.isError) return <>{formatEventPrice(event)}</>
  const current = query.data
  if (!current || current.event.admission_type !== 'paid') {
    return <>{formatEventPrice(event, null)}</>
  }
  const available = current.tiers.filter(tier => tier.availability_status === 'available')
  return <>{formatEventPrice(event, {
    status: available.length ? 'available' : 'sold_out',
    minimumPriceMinor: available.length ? Math.min(...available.map(tier => tier.unit_amount_minor)) : null,
  })}</>
}

export const EventPreviewCard = forwardRef<HTMLElement, EventPreviewCardProps>(function EventPreviewCard(
  { event, navigation, onClose, onBack, publicArtworkUrl, onOpenEvent }, ref,
) {
  const titleId = useId()
  const explanationId = useId()
  const artworkUrl = publicArtworkUrl === undefined ? resolvePublicArtworkUrl(event.artworkReference) : publicArtworkUrl
  const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(null)
  const schedule = formatEventDateTime(event)

  return (
    <article ref={ref} className="event-preview event-preview--invitation" role="region" tabIndex={-1} aria-labelledby={titleId} aria-live="polite">
      <div className="event-preview__scroll">
        <div className="event-invitation__hero">
          {artworkUrl && failedArtworkUrl !== artworkUrl ? (
            <img key={artworkUrl} className="event-preview__artwork" src={artworkUrl} alt={`${event.title} artwork`} onError={() => setFailedArtworkUrl(artworkUrl)} />
          ) : <ArtworkFallback title={event.title} />}
        </div>
        <div className="event-invitation__body">
          <p className="event-preview__eyebrow">{categoryLabels[event.category]}</p>
          <div className="event-preview__copy">
            <h2 id={titleId}>{event.title}</h2>
            {navigation.kind === 'disabled' ? <p className="event-preview__indication">{navigation.indication}</p> : null}
          </div>
          <dl className="event-preview__details">
            <div className="event-preview__when"><dt>When</dt><dd><time dateTime={event.startsAt}>{schedule.date}</time><span>{schedule.time}</span></dd></div>
            <div><dt>Venue</dt><dd>{event.venueLabel || 'See event for location details'}</dd></div>
            <div><dt>Admission</dt><dd><span role="group" aria-label="Admission">{event.admissionType === 'paid' && navigation.kind === 'enabled' ? <LivePaidAdmission event={event} /> : formatEventPrice(event)}</span></dd></div>
          </dl>
          {navigation.kind === 'enabled' ? <EventDescription key={event.id} eventId={event.id} /> : null}
        </div>
      </div>
      <button className="event-preview__close" type="button" aria-label="Close event preview" onClick={onClose}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
      </button>
      <div className="event-preview__footer">
        {onBack ? <button className="event-preview__back" type="button" onClick={onBack}>Back to events</button> : null}
        {navigation.kind === 'enabled' ? (
          <Link className="event-preview__action" to={navigation.to} onClick={event => {
            if (onOpenEvent && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onOpenEvent(navigation.to) }
          }}>View event</Link>
        ) : (
          <button
            className="event-preview__action"
            type="button"
            disabled
            aria-describedby={navigation.kind === 'disabled' ? explanationId : undefined}
          >View event</button>
        )}
        {navigation.kind === 'disabled' ? <p className="event-preview__explanation" id={explanationId}>{navigation.explanation}</p> : null}
      </div>
    </article>
  )
})
