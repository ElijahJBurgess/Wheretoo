import { forwardRef, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import type { WheretooMapEvent } from '../data/wheretooMapEvents'
import { formatEventDateTime, formatEventPrice, resolvePublicArtworkUrl } from './eventPreviewFormatting'
import type { EventPreviewNavigation } from './eventPreviewNavigation'

type EventPreviewCardProps = {
  event: WheretooMapEvent
  navigation: EventPreviewNavigation
  onOpenEvent?(to: string): void
  onClose(): void
  onBack?(): void
  /** URL from the canonical public event-image resolver; null means no public cover. */
  publicArtworkUrl?: string | null
}

function ArtworkFallback() {
  return (
    <span className="event-preview__artwork-fallback" aria-label="Event artwork unavailable">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3v3M17 3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
        <path d="m9.3 15.2 1.8 1.8 3.8-4.2" />
      </svg>
    </span>
  )
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
    <article ref={ref} className="event-preview" tabIndex={-1} role="region" aria-labelledby={titleId} aria-live="polite">
      <div className="event-preview__scroll">
        <div className="event-preview__topline">
          <p className="event-preview__eyebrow">wheretoo event</p>
          <button className="event-preview__close" type="button" aria-label="Close event preview" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
          </button>
        </div>
        <div className="event-preview__identity">
          {artworkUrl && failedArtworkUrl !== artworkUrl ? (
            <img key={artworkUrl} className="event-preview__artwork" src={artworkUrl} alt={`${event.title} artwork`} onError={() => setFailedArtworkUrl(artworkUrl)} />
          ) : <ArtworkFallback />}
          <div className="event-preview__copy">
            <h2 id={titleId}>{event.title}</h2>
            {navigation.kind === 'disabled' ? <p className="event-preview__indication">{navigation.indication}</p> : null}
          </div>
        </div>
        <dl className="event-preview__details">
          <div className="event-preview__when"><dt>When</dt><dd><span>{schedule.date}</span><span>{schedule.time}</span></dd></div>
          <div><dt>Venue</dt><dd>{event.venueLabel}</dd></div>
          <div><dt>Admission</dt><dd>{formatEventPrice(event)}</dd></div>
        </dl>
      </div>
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
