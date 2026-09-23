import { startStorefrontTransaction } from './storefront.attribution'
import { StorefrontShare } from './StorefrontShare'
import { type ReactNode, useState } from 'react'
import { StorefrontIcon } from './StorefrontIcon'
import { Link } from 'react-router-dom'
import { StorefrontMedia } from './StorefrontMedia'
import {
  safeExternalUrl,
  socialLabels,
  validSocialUrl,
} from './storefront.editor'
import { eventFlyerUrl } from './storefront.api'
import type { StorefrontDocument, StorefrontEvent } from './storefront.schemas'
import '../buyer-journey/buyer.css'
import './storefront.css'
function price(event: StorefrontEvent) {
  if (event.admission.state === 'sold_out') return 'Sold Out'
  if (event.admission.state !== 'available') return 'Unavailable'
  if (event.admissionType === 'free') return 'Free'
  if (
    event.admission.minimumAmountMinor === null || !event.admission.currency
  ) return 'Unavailable'
  return `From ${
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: event.admission.currency,
    }).format(event.admission.minimumAmountMinor / 100)
  }`
}
export function StorefrontEventCard(
  { event, featured = false, track = false }: {
    event: StorefrontEvent
    featured?: boolean
    track?: boolean
  },
) {
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    timeZone: event.timezone,
  }).format(new Date(event.startsAt))
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: event.timezone,
  }).format(new Date(event.startsAt))
  return (
    <article
      className={`storefront-event ${
        featured ? 'storefront-event--featured' : ''
      }`}
    >
      {event.flyerId
        ? (
          <img
            className='storefront-flyer'
            src={eventFlyerUrl(event.flyerId)}
            alt={`${event.title} — flyer`}
            loading={featured ? 'eager' : 'lazy'}
            width='400'
            height='500'
          />
        )
        : (
          <div
            className='storefront-flyer storefront-flyer--empty'
            aria-label='No event flyer'
          >
            WHERETOO
          </div>
        )}
      <div className='storefront-event__info'>
        <h3>
          {featured ? event.title : (
            <Link
              className='storefront-event-title'
              to={`/events/${event.id}`}
            >
              {event.title}
            </Link>
          )}
        </h3>
        <p className='storefront-date'>
          <StorefrontIcon name='calendar' />
          <time dateTime={event.startsAt}>{date}</time>
        </p>
        <p>
          <StorefrontIcon name='pin' />
          <span>
            {event.venue}
            {event.venue && event.city ? <br /> : null}
            {event.city}
          </span>
        </p>
        <p>
          <StorefrontIcon name='clock' />
          <span>{time}</span>
        </p>
        <strong
          className={event.admission.state === 'available'
            ? 'storefront-price'
            : 'storefront-status'}
        >
          {price(event)}
        </strong>
        {event.admission.state === 'available'
          ? (
            <Link
              onClick={() => {
                if (track) {
                  startStorefrontTransaction(
                    event.id,
                    event.admissionType,
                  )
                }
              }}
              className='storefront-cta'
              to={`/events/${event.id}/${
                event.admissionType === 'paid' ? 'tickets' : 'rsvp'
              }`}
            >
              {event.admissionType === 'paid' ? 'Get Tickets' : 'RSVP'}
            </Link>
          )
          : null}
        {featured
          ? (
            <Link className='storefront-details' to={`/events/${event.id}`}>
              View Event Details
            </Link>
          )
          : null}
      </div>
    </article>
  )
}
export function StorefrontView(
  { data, more, share, ownerId }: {
    data: StorefrontDocument
    more?: ReactNode
    share?: ReactNode
    ownerId?: string
  },
) {
  const o = data.identity
  const [activeSection, setActiveSection] = useState('events')
  const merch = data.merch.filter((item) => safeExternalUrl(item.url))
  const storeUrl = data.storeUrl && safeExternalUrl(data.storeUrl)
    ? data.storeUrl
    : null
  const hasMerch = merch.length > 0 || !!storeUrl
  const links = Object.entries(o.links).filter(([key, url]) =>
    validSocialUrl(key, url)
  )
  const website = o.websiteUrl && safeExternalUrl(o.websiteUrl)
    ? o.websiteUrl
    : null
  const longBio = !!o.bio && o.bio.length > 160
  const hasAbout = !!(longBio || o.city || links.length || website)
  const publicPath = o.handle ? `/${encodeURIComponent(o.handle)}` : null
  const publicUrl = publicPath ? `${window.location.origin}${publicPath}` : null
  const socialLinks = (label: string) =>
    links.length || website
      ? (
        <nav className='storefront-links' aria-label={label}>
          {links.map(([key, url]) => (
            <a
              key={key}
              href={url}
              aria-label={socialLabels[key as keyof typeof socialLabels]}
              title={socialLabels[key as keyof typeof socialLabels]}
              rel='noopener noreferrer'
              target='_blank'
            >
              <StorefrontIcon name={key as keyof typeof socialLabels} />
            </a>
          ))}
          {website
            ? (
              <a
                href={website}
                aria-label='Website'
                title='Website'
                rel='noopener noreferrer'
                target='_blank'
              >
                <StorefrontIcon name='website' />
              </a>
            )
            : null}
        </nav>
      )
      : null
  return (
    <main
      className={`buyer-page storefront${
        o.coverId ? ' storefront--has-cover' : ''
      }`}
      data-accent={o.accent ?? 'violet'}
    >
      <header className='storefront-header'>
        <Link
          className='storefront-wordmark'
          to='/discover'
          aria-label='Wheretoo discovery'
        >
          Wheretoo
        </Link>
        <nav className='storefront-global-nav' aria-label='Wheretoo navigation'>
          <Link to='/discover'>Discover Events</Link>
          <Link to='/organizer/events'>For Organizers</Link>
        </nav>
        {share ?? (!ownerId && o.handle
          ? <StorefrontShare handle={o.handle} name={o.name} />
          : null)}
      </header>
      {o.coverId
        ? (
          <StorefrontMedia
            key={o.coverId}
            id={o.coverId}
            ownerId={ownerId}
            className='storefront-cover'
            alt=''
          />
        )
        : null}
      <section className='storefront-identity' aria-label='Organizer identity'>
        {o.logoId
          ? (
            <StorefrontMedia
              key={o.logoId}
              id={o.logoId}
              ownerId={ownerId}
              className='storefront-logo'
              alt={`${o.name} logo`}
            />
          )
          : null}
        <div className='storefront-identity__copy'>
          <h1>{o.name}</h1>
          <div className='storefront-identity__meta'>
            {o.handle ? <p className='storefront-handle'>@{o.handle}</p> : null}
            {publicPath && publicUrl
              ? (
                <a className='storefront-permalink' href={publicPath}>
                  {publicUrl.replace(/^https?:\/\//, '')}
                </a>
              )
              : null}
            {o.city
              ? (
                <p className='storefront-city'>
                  <StorefrontIcon name='pin' />
                  {o.city}
                </p>
              )
              : null}
          </div>
          {o.bio
            ? (
              <p className='storefront-bio'>
                {longBio ? `${o.bio.slice(0, 157).trimEnd()}…` : o.bio}
              </p>
            )
            : null}
        </div>
        {socialLinks('Organizer links')}
      </section>
      <nav className='storefront-tabs' aria-label='Storefront sections'>
        {[
          ['events', 'Events'],
          ...(hasMerch ? [['merch', 'Merch']] : []),
          ...(hasAbout ? [['about', 'About']] : []),
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#storefront-${id}`}
            aria-current={activeSection === id ? 'location' : undefined}
            onClick={() => setActiveSection(id)}
          >
            {label}
          </a>
        ))}
      </nav>
      <div
        id='storefront-events'
        className={`storefront-content${
          data.featured && data.events.length > 2
            ? ' storefront-content--extended'
            : ''
        }`}
      >
        <div
          className={`storefront-events-layout${
            data.featured ? '' : ' storefront-events-layout--unfeatured'
          }`}
        >
          {data.featured
            ? (
              <section
                className='storefront-section storefront-featured'
                aria-labelledby='storefront-featured-title'
              >
                <h2 id='storefront-featured-title'>Featured Event</h2>
                <StorefrontEventCard
                  event={data.featured}
                  featured
                  track={!ownerId}
                />
              </section>
            )
            : null}
          <section
            className='storefront-section storefront-upcoming'
            aria-labelledby='storefront-upcoming-title'
          >
            <h2 id='storefront-upcoming-title'>Upcoming Events</h2>
            <div className='storefront-upcoming-list'>
              {data.events.length
                ? data.events.map((event) => (
                  <StorefrontEventCard
                    key={event.id}
                    event={event}
                    track={!ownerId}
                  />
                ))
                : (
                  <p className='storefront-empty'>
                    {data.featured
                      ? 'More events will appear here.'
                      : 'No upcoming events right now.'}
                  </p>
                )}
            </div>
            {more}
          </section>
        </div>
        <div className='storefront-secondary-layout'>
          {hasMerch
            ? (
              <section
                id='storefront-merch'
                className='storefront-section storefront-merch-section'
                aria-labelledby='storefront-merch-title'
              >
                <div className='storefront-section-heading'>
                  <h2 id='storefront-merch-title'>Merch</h2>
                  {storeUrl
                    ? (
                      <a
                        href={storeUrl}
                        target='_blank'
                        rel='noopener noreferrer'
                      >
                        Visit Store <StorefrontIcon name='external' />
                      </a>
                    )
                    : null}
                </div>
                <div className='storefront-merch'>
                  {merch.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target='_blank'
                      rel='noopener noreferrer'
                    >
                      <StorefrontMedia
                        id={item.imageId}
                        ownerId={ownerId}
                        alt={item.title}
                        className='storefront-merch-image'
                        loading='lazy'
                      />
                      <div className='storefront-merch__label'>
                        <h3>{item.title}</h3>
                        <StorefrontIcon name='external' />
                      </div>
                      {item.price ? <p>{item.price}</p> : null}
                    </a>
                  ))}
                </div>
              </section>
            )
            : null}
          {hasAbout
            ? (
              <section
                id='storefront-about'
                className='storefront-section storefront-about'
                aria-labelledby='storefront-about-title'
              >
                <h2 id='storefront-about-title'>About {o.name}</h2>
                {longBio ? <p>{o.bio}</p> : null}
                {o.city
                  ? (
                    <p className='storefront-city'>
                      <StorefrontIcon name='pin' />
                      {o.city}
                    </p>
                  )
                  : null}
                {socialLinks('About organizer links')}
              </section>
            )
            : null}
        </div>
      </div>
      <footer className='storefront-footer'>
        <Link className='storefront-wordmark' to='/discover'>Wheretoo</Link>
        <nav aria-label='Footer navigation'>
          <Link to='/discover'>Discover Events</Link>
          <Link to='/organizer/events'>For Organizers</Link>
          <Link to='/organizer-terms'>Organizer Terms</Link>
          <Link to='/event-policy'>Event Policy</Link>
        </nav>
      </footer>
    </main>
  )
}
