import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { EventCategory } from '../events/event.types'
import { defaultDiscoveryFilters, toggleDiscoveryFilter } from './discovery.filters'
import {
  categoryLabel,
  discoveryAdmissionLabel,
  discoverySchedule,
  selectDiscoveryHighlight,
} from './discovery.presentation'
import type { DiscoveryDisplayItem, DiscoveryFilters } from './discovery.types'
import './discovery.css'

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

const categoryShortcuts = ['music', 'nightlife', 'food_drink'] as const satisfies readonly EventCategory[]

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
        <DiscoveryArtwork hero item={item} />
        <div className="discovery-hero__scrim" />
        <div className="discovery-hero__copy">
          <p className="discovery-kicker">Coming up</p>
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
          <span className="discovery-admission discovery-event-row__mobile-admission" data-testid="mobile-admission">{discoveryAdmissionLabel(item)}</span>
        </span>
        <span className="discovery-event-row__end">
          <span className="discovery-admission">{discoveryAdmissionLabel(item)}</span>
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
  const categories: readonly EventCategory[] = filters.category && !categoryShortcuts.includes(filters.category as typeof categoryShortcuts[number])
    ? [...categoryShortcuts, filters.category]
    : categoryShortcuts
  return (
    <section aria-label="Filter events" className="discovery-filters">
      <div aria-label="Date" className="discovery-chip-group" role="group">
        {dateFilters.map(([value, label]) => (
          <button
            aria-pressed={filters.when === value}
            key={value}
            onClick={() => onChange({ ...filters, when: value })}
            type="button"
          >{label}</button>
        ))}
      </div>
      <div className="discovery-filter-scroll discovery-secondary-filters">
        <div aria-label="Category" className="discovery-chip-group" role="group">
          {categories.map((category) => (
            <button
              aria-pressed={filters.category === category}
              key={category}
              onClick={() => onChange(toggleDiscoveryFilter(filters, 'category', category))}
              type="button"
            >{categoryLabel(category)}</button>
          ))}
        </div>
        <div aria-label="Admission" className="discovery-chip-group discovery-chip-group--price" role="group">
          {(['free', 'paid'] as const).map((price) => (
            <button
              aria-pressed={filters.price === price}
              key={price}
              onClick={() => onChange(toggleDiscoveryFilter(filters, 'price', price))}
              type="button"
            >{price === 'free' ? 'Free' : 'Paid'}</button>
          ))}
        </div>
      </div>
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
          <Link aria-label="Wheretoo discovery home" className="discovery-wordmark" to="/discover">wheretoo</Link>
          <p className="discovery-location"><PinMark /><span>SF Bay Area</span></p>
          <nav aria-label="Public navigation" className="discovery-nav">
            <Link aria-current="page" to={discoverDestination}><span aria-hidden="true">⌕</span>Discover</Link>
            <Link to="/organizer/events"><span aria-hidden="true">◇</span>Organize</Link>
          </nav>
        </header>

        <section className="discovery-intro">
          <h1>Somewhere to <em>go?</em></h1>
          <p>People<br />Places<br />Good times</p>
        </section>

        <DiscoveryFiltersView filters={filters} onChange={onFiltersChange} />

        <section aria-labelledby="discovery-results-heading" className="discovery-results" id="discovery-results">
          <div className="discovery-results__heading">
            <h2 id="discovery-results-heading">Events</h2>
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

          {highlight ? <EventLink eventHref={eventHref} item={highlight} publicSearch={publicSearch} variant="hero" /> : null}
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
      </div>
    </main>
  )
}
