import { useState, type ReactNode } from 'react'
import { BuyerHeader, BuyerIcon } from './BuyerPrimitives'

export function EventPageView({ title, organizer, date, time, venue, location, description, artwork, badge, selection = false, back, action, children }: {
  title: string; organizer: string; date: string; time?: string; venue: string; location: string; description: string
  badge?: string; artwork?: string | null; selection?: boolean; back?: ReactNode; action?: ReactNode; children?: ReactNode
}) {
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null)
  const visibleArtwork = artwork && artwork !== failedArtwork ? artwork : null
  return <main className={`buyer-page buyer-event${selection ? ' buyer-event--selection' : ''}`}>
    <BuyerHeader back={back} />
    <article aria-labelledby="public-event-title">
      <div className={`buyer-event-hero${visibleArtwork ? '' : ' buyer-event-hero--no-artwork'}`}>
        {visibleArtwork ? <img key={visibleArtwork} className="buyer-event-hero__image" src={visibleArtwork} alt={`${title} event artwork`} onError={() => setFailedArtwork(visibleArtwork)} /> : null}
        <div className="buyer-event-hero__copy">
          {badge ? <span className="rsvp-badge">{badge}</span> : null}<h1 tabIndex={-1} id="public-event-title">{title}</h1><p className="buyer-event__organizer">Hosted by {organizer}</p>
          <dl className="buyer-event-facts">
            <div><dt><BuyerIcon name="calendar" /><span className="buyer-visually-hidden">When</span></dt><dd><span>{date}</span>{time ? <span>{time}</span> : null}</dd></div>
            <div><dt><BuyerIcon name="pin" /><span className="buyer-visually-hidden">Where</span></dt><dd><span>{venue}</span><span>{location}</span></dd></div>
          </dl>
          {action ? <div className="buyer-event__action">{action}</div> : null}
          {!selection ? <p className="buyer-event__description">{description}</p> : null}
        </div>
      </div>
      {children ? <div className="buyer-content buyer-event__lower">{children}</div> : null}
    </article>
  </main>
}
