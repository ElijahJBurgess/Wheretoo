import { useState } from 'react'
import { Link } from 'react-router-dom'
import { eventCategories, type EventCategory } from '../events/event.types'
import { defaultDiscoveryFilters } from './discovery.filters'
import {
  categoryLabel,
  discoveryAdmissionLabel,
  discoverySchedule,
  selectDiscoveryHighlight,
} from './discovery.presentation'
import type { DiscoveryDisplayItem, DiscoveryFilters } from './discovery.types'
import './discovery.css'
import '../../components/layout/platform-brand.css'
import discoveryHero from './assets/bay-bridge-night.jpg'

export type DiscoveryViewProps = {
  filters: DiscoveryFilters
  items: readonly DiscoveryDisplayItem[]
  highlightItems?: readonly DiscoveryDisplayItem[]
  status: 'loading' | 'error' | 'ready'
  errorKind?: 'unavailable' | 'invalid_response' | 'rate_limited'
  retryAfterSeconds?: number
  hasMore: boolean
  isLoadingMore: boolean
  moreError?: string | null
  notice?: string | null
  invalidItemCount?: number
  onFiltersChange(filters: DiscoveryFilters): void
  onRefresh(): void
  onLoadMore(): void
  onRetry(): void
  publicSearch: string
  eventHref?(item: DiscoveryDisplayItem): string
}

const dateFilters = [
  ['upcoming', 'Upcoming'],
  ['today', 'Today'],
  ['weekend', 'This weekend'],
] as const

const shortcuts = [
  ['This Weekend', 'Make a little room for going out.', '/discover?when=weekend'],
  ['Free Events', 'Good plans. No ticket price.', '/discover?price=free'],
  ['Music', 'Find your next live soundtrack.', '/discover?category=music'],
  ['Food & Drink', 'Something worth gathering around.', '/discover?category=food_drink'],
] as const

const fallbackMarks = {
  food_drink: 'F+D', music: 'M', fitness: 'MOVE', art_culture: 'A+C',
  shopping: 'SHOP', community: 'COMM', nightlife: 'N', other: 'W',
} as const

function DiscoveryArtwork({ item, hero = false }: { item: DiscoveryDisplayItem; hero?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (item.artworkReference && item.artworkReference !== failedUrl) {
    return (
      <img
        alt=""
        className="discovery-artwork__image"
        decoding="async"
        fetchPriority={hero ? 'high' : 'auto'}
        loading={hero ? 'eager' : 'lazy'}
        onError={() => setFailedUrl(item.artworkReference)}
        src={item.artworkReference}
      />
    )
  }
  return (
    <span
      aria-label={`${categoryLabel(item.category)} event artwork`}
      className={`discovery-artwork__fallback discovery-artwork__fallback--${item.category}`}
      role="img"
    >
      <span>{fallbackMarks[item.category]}</span>
    </span>
  )
}

function ArrowMark() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>
}

function PinMark() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12Z" /><circle cx="12" cy="9" r="2" /></svg>
}

function EventPlace({ item }: { item: DiscoveryDisplayItem }) {
  return (
    <span className="discovery-event-place">
      <PinMark />
      <span>{item.venueName ? `${item.venueName} · ` : ''}{item.city}</span>
    </span>
  )
}

function EventLink({ item, publicSearch, variant, eventHref }: {
  item: DiscoveryDisplayItem
  publicSearch: string
  variant: 'hero' | 'row'
  eventHref?: DiscoveryViewProps['eventHref']
}) {
  const destination = eventHref?.(item) ?? `/events/${encodeURIComponent(item.id)}`
  if (variant === 'hero') {
    return (
      <article className="discovery-hero">
        <div className="discovery-hero__flyer"><DiscoveryArtwork hero item={item} /></div>
        <div className="discovery-hero__copy">
          <p className="discovery-kicker">Featured</p>
          <h2>{item.title}</h2>
          <p className="discovery-event-schedule">{discoverySchedule(item)}</p>
          <EventPlace item={item} />
          <div className="discovery-hero__action-row">
            <span className="discovery-admission">{discoveryAdmissionLabel(item)}</span>
            <Link
              aria-label={`View ${item.title}`}
              className="discovery-hero__action"
              state={{ discoverySearch: publicSearch }}
              to={destination}
            >
              View event <ArrowMark />
            </Link>
          </div>
        </div>
      </article>
    )
  }
  return (
    <li className="discovery-event-row">
      <Link aria-label={`View ${item.title}`} state={{ discoverySearch: publicSearch }} to={destination}>
        <span className="discovery-event-row__art"><DiscoveryArtwork item={item} /></span>
        <span className="discovery-event-row__copy">
          <span className="discovery-event-row__category">{categoryLabel(item.category)}</span>
          <strong>{item.title}</strong>
          <span className="discovery-event-schedule">{discoverySchedule(item)}</span>
          <EventPlace item={item} />
          <span className="discovery-admission">{discoveryAdmissionLabel(item)}</span>
        </span>
        <span className="discovery-event-row__end">
          <span>View event</span>
          <ArrowMark />
        </span>
      </Link>
    </li>
  )
}

function DiscoveryFiltersView({ filters, onChange }: {
  filters: DiscoveryFilters
  onChange(filters: DiscoveryFilters): void
}) {
  const filtered = filters.when !== 'upcoming' || filters.category !== null || filters.price !== null
  return (
    <section aria-label="Filter events" className="discovery-filters">
      <div className="discovery-filter-region"><PinMark /><span>SF Bay Area</span></div>
      <label>Date<select value={filters.when} onChange={(event) => onChange({ ...filters, when: event.target.value as DiscoveryFilters['when'] })}>
        {dateFilters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Category<select value={filters.category ?? ''} onChange={(event) => onChange({ ...filters, category: (event.target.value || null) as EventCategory | null })}>
        <option value="">All categories</option>
        {eventCategories.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}
      </select></label>
      <label>Admission<select value={filters.price ?? ''} onChange={(event) => onChange({ ...filters, price: (event.target.value || null) as DiscoveryFilters['price'] })}>
        <option value="">Any price</option><option value="free">Free</option><option value="paid">Paid</option>
      </select></label>
      <a className="discovery-explore" href="#discovery-results">Explore events <ArrowMark /></a>
      {filtered ? <button className="discovery-clear-filters" onClick={() => onChange(defaultDiscoveryFilters)} type="button">Clear filters</button> : null}
    </section>
  )
}

function LoadingResults() {
  return (
    <section aria-busy="true" aria-live="polite" className="discovery-results-state" role="status">
      <p className="discovery-state-title">Loading events</p>
      <div aria-hidden="true" className="discovery-skeletons">
        {Array.from({ length: 4 }, (_, index) => <span key={index}><i /><b /><b /></span>)}
      </div>
    </section>
  )
}

function ErrorResults({ errorKind, retryAfterSeconds, onRetry }: Pick<DiscoveryViewProps, 'errorKind' | 'retryAfterSeconds' | 'onRetry'>) {
  const invalid = errorKind === 'invalid_response'
  const retryDelayed = (retryAfterSeconds ?? 0) > 0
  return (
    <section aria-live="assertive" className="discovery-results-state discovery-results-state--error" role="alert">
      <p className="discovery-state-title">{invalid ? 'Events are temporarily unavailable.' : 'We couldn’t load events.'}</p>
      <p>{errorKind === 'rate_limited' ? `Try again in ${retryAfterSeconds ?? 60} seconds.` : 'Check your connection and try again.'}</p>
      <button className="discovery-state-action" disabled={retryDelayed} onClick={onRetry} type="button">Try again</button>
    </section>
  )
}

export function DiscoveryView({
  filters, items, highlightItems, status, errorKind, retryAfterSeconds, hasMore, isLoadingMore,
  moreError, notice, invalidItemCount = 0, onFiltersChange, onRefresh, onLoadMore, onRetry, publicSearch,
  eventHref,
}: DiscoveryViewProps) {
  const highlightCandidate = status === 'ready' ? selectDiscoveryHighlight(highlightItems ?? items) : null
  const highlight = highlightCandidate ? items.find((item) => item.id === highlightCandidate.id) ?? null : null
  const rows = highlight ? items.filter((item) => item.id !== highlight.id) : items
  const filtered = filters.when !== 'upcoming' || filters.category !== null || filters.price !== null
  const retryDelayed = (retryAfterSeconds ?? 0) > 0
  const windowLabel = filters.when === 'today' ? 'Today' : filters.when === 'weekend' ? 'This weekend' : 'Next 30 days'
  const discoverDestination = `/discover${publicSearch}`

  return (
    <main className="discovery-page">
      <div className="discovery-shell">
        <header className="discovery-header">
          <Link aria-label="Wheretoo discovery home" className="discovery-wordmark platform-wordmark" to="/discover">wheretoo</Link>
          <nav aria-label="Public navigation" className="discovery-nav">
            <Link aria-current="page" to={discoverDestination}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m15 9-2 4-4 2 2-4Z" /></svg>Discover</Link>
            <Link to="/organizer/events"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="15" rx="3" /><path d="M8 3v6m8-6v6M4 12h16" /></svg>Organize</Link>
          </nav>
        </header>

        <section className="discovery-intro">
          <div className="discovery-intro__copy"><p className="discovery-eyebrow">Bay Area events · Curated for real life</p><h1>Find somewhere worth going.</h1>
            <p>Live music. Great food. Late nights. New people. <span className="discovery-intro__continuation">A more interesting Bay Area awaits.</span></p></div>
          <img className="discovery-intro__media" src={discoveryHero} width="2103" height="748" alt="" fetchPriority="high" />
        </section>

        <DiscoveryFiltersView filters={filters} onChange={onFiltersChange} />

        <section aria-labelledby="discovery-results-heading" className="discovery-results" id="discovery-results">
          {highlight ? <div className="discovery-feature-row">
            <EventLink eventHref={eventHref} item={highlight} publicSearch={publicSearch} variant="hero" />
            <aside aria-label="Map area" className="discovery-map-placeholder">
              <span>Map coming later</span>
            </aside>
          </div> : null}
          <div className="discovery-results__heading">
            <h2 id="discovery-results-heading">{filters.when === 'today' ? 'Today in the Bay' : filters.when === 'weekend' ? 'This weekend in the Bay' : 'Coming up in the Bay'}</h2>
            <span>{windowLabel}</span>
            <button disabled={retryDelayed} onClick={onRefresh} type="button">Refresh</button>
          </div>
          {status === 'ready' ? <p aria-label="Discovery results" aria-live="polite" className="discovery-visually-hidden" role="status">{items.length} {items.length === 1 ? 'event' : 'events'}</p> : null}
          {notice ? <p aria-live="polite" className="discovery-notice" role="status">{notice}</p> : null}
          {invalidItemCount > 0 ? (
            <p aria-live="polite" className="discovery-notice">
              {invalidItemCount} {invalidItemCount === 1 ? 'event could' : 'events could'} not be shown.
            </p>
          ) : null}

          {status === 'loading' ? <LoadingResults /> : null}
          {status === 'error' ? <ErrorResults errorKind={errorKind} retryAfterSeconds={retryAfterSeconds} onRetry={onRetry} /> : null}
          {status === 'ready' && items.length === 0 ? (
            <section aria-live="polite" className="discovery-results-state" role="status">
              <p className="discovery-state-title">{filtered ? 'No events match these filters.' : 'No upcoming events here yet.'}</p>
              <p>{filtered ? 'Clear the filters to see everything coming up.' : 'New SF Bay Area events will appear here as they are published.'}</p>
              {filters.when === 'today' ? <button className="discovery-state-action" onClick={() => onFiltersChange({ ...filters, when: 'upcoming' })} type="button">See upcoming events</button> : null}
            </section>
          ) : null}

          {status === 'ready' && rows.length > 0 ? (
            <ul aria-label="Events" className="discovery-event-list">
              {rows.map((item) => <EventLink eventHref={eventHref} item={item} key={item.id} publicSearch={publicSearch} variant="row" />)}
            </ul>
          ) : null}

          {status === 'ready' && moreError ? (
            <div className="discovery-more-error" role="alert">
              <p>{moreError}</p>
              <button disabled={retryDelayed} onClick={onLoadMore} type="button">Try loading more</button>
            </div>
          ) : null}
          {status === 'ready' && !moreError && hasMore ? (
            <button className="discovery-load-more" disabled={isLoadingMore || retryDelayed} onClick={onLoadMore} type="button">
              {isLoadingMore ? 'Loading more events…' : 'Load more'}
            </button>
          ) : null}
          {status === 'ready' && items.length > 0 && !hasMore && !moreError ? <p className="discovery-end">That’s everything coming up.</p> : null}
        </section>
        <nav aria-label="Explore more events" className="discovery-shortcuts">
          {shortcuts.map(([title, description, destination]) => <Link key={title} to={destination}>
            <span><strong>{title}</strong><span>{description}</span></span><ArrowMark />
          </Link>)}
        </nav>
      </div>
    </main>
  )
}
