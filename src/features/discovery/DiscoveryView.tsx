import { useRef, useState, type ReactNode } from 'react'
import type { DiscoveryMode } from './discovery.location'
import { DiscoveryMapPreview } from './DiscoveryMapPreview'
import { Link } from 'react-router-dom'
import { DiscoveryFilters as FilterControls } from './DiscoveryFilters'
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
  mode?: DiscoveryMode
  onModeChange?(mode: DiscoveryMode): void
  filters: DiscoveryFilters
  items: readonly DiscoveryDisplayItem[]
  highlightItems?: readonly DiscoveryDisplayItem[]
  status: 'loading' | 'error' | 'ready'
  errorKind?: 'unavailable' | 'invalid_response' | 'rate_limited'
  retryAfterSeconds?: number
  hasMore: boolean
  isLoadingMore: boolean
  isRefreshing?: boolean
  isRefreshError?: boolean
  moreError?: string | null
  notice?: string | null
  invalidItemCount?: number
  onFiltersChange(filters: DiscoveryFilters, field?: keyof DiscoveryFilters): void
  onRefresh(): void
  onLoadMore(): void
  onRetry(): void
  publicSearch: string
  mapPreview?: ReactNode
  onBroadenArea?(): void
  canBroadenArea?: boolean
  regionFallback?: boolean
  eventHref?(item: DiscoveryDisplayItem): string
}

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

function LoadingResults({ refreshing = false }: { refreshing?: boolean }) {
  return (
    <section aria-busy="true" aria-live="polite" className="discovery-results-state" role="status">
      <p className="discovery-state-title">{refreshing ? 'Checking for events…' : 'Loading events'}</p>
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
  mapPreview, onBroadenArea, canBroadenArea = true, regionFallback = false, moreError, notice, invalidItemCount = 0, onFiltersChange, onRefresh, onLoadMore, onRetry, publicSearch,
  eventHref, mode = 'map', onModeChange, isRefreshing = false, isRefreshError = false,
}: DiscoveryViewProps) {
  const modeButtons = useRef<Partial<Record<DiscoveryMode, HTMLButtonElement>>>({})
  const resultsHeading = useRef<HTMLHeadingElement>(null)
  const highlightCandidate = status === 'ready' ? selectDiscoveryHighlight(highlightItems ?? items) : null
  const highlight = highlightCandidate ? items.find((item) => item.id === highlightCandidate.id) ?? null : null
  const rows = highlight ? items.filter((item) => item.id !== highlight.id) : items
  const nondefaultFilters = filters.when !== 'next7' || filters.category !== null || filters.price !== null
  // A legacy 30-day window is wider than the default, not a restriction.
  const filtered = filters.when === 'today' || filters.when === 'weekend' || filters.category !== null || filters.price !== null
  const feedback = status === 'loading' || (!items.length && isRefreshing) ? 'checking'
    : status === 'error' || (!items.length && isRefreshError) ? 'error'
      : !items.length ? hasMore || invalidItemCount > 0 || moreError ? 'partial' : 'empty' : null
  const changeEmptyFilters = (next: DiscoveryFilters) => {
    resultsHeading.current?.focus({ preventScroll: true })
    onFiltersChange(next)
  }
  const retryDelayed = (retryAfterSeconds ?? 0) > 0
  const windowLabel = filters.when === 'today' ? 'Today' : filters.when === 'weekend' ? 'This weekend' : filters.when === 'upcoming' ? 'Next 30 Days' : 'Next 7 Days'
  const discoverDestination = `/discover${publicSearch}`

  return (
    <main className="discovery-page">
      <div className="discovery-shell">
        <header className="discovery-header">
          <Link aria-label="Wheretoo discovery home" className="discovery-wordmark platform-wordmark" to="/discover">wheretoo</Link>
          <nav aria-label="Public navigation" className="discovery-nav">
            <Link aria-current="page" to={discoverDestination}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m15 9-2 4-4 2 2-4Z" /></svg>Discover</Link>
            <Link to={'/map' + publicSearch}><PinMark />Map</Link>
            <Link to="/organizer/events"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="15" rx="3" /><path d="M8 3v6m8-6v6M4 12h16" /></svg>Organize</Link>
          </nav>
        </header>

        <section className="discovery-intro">
          <div className="discovery-intro__copy"><p className="discovery-eyebrow">Bay Area events · Curated for real life</p><h1>Find somewhere worth going.</h1>
            <p>Live music. Great food. Late nights. New people. <span className="discovery-intro__continuation">A more interesting Bay Area awaits.</span></p></div>
          <img className="discovery-intro__media" src={discoveryHero} width="2103" height="748" alt="" fetchPriority="high" />
        </section>

        <FilterControls filters={filters} onChange={onFiltersChange} />

        <div className={`discovery-workspace discovery-workspace--${mode}`}>
        <div className="discovery-mode-bar">
          <div className="discovery-mode-toggle" role="group" aria-label="Discovery view" onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' || event.key === 'ArrowLeft' ? 'map' : 'list'
            modeButtons.current[next]?.focus({ preventScroll: true })
            onModeChange?.(next)
          }}>
            {(['map', 'list'] as const).map(option => <button key={option} ref={node => { modeButtons.current[option] = node ?? undefined }} type="button" aria-pressed={mode === option} aria-controls={`discovery-${option}-panel`} onClick={() => onModeChange?.(option)}>{option === 'map' ? 'Map' : 'List'}</button>)}
          </div>
          <Link className="discovery-full-map" to={'/map' + publicSearch}>Expand map <ArrowMark /></Link>
        </div>
        <div className="discovery-panels">
        <div id="discovery-map-panel" className={`discovery-map-panel${mode === 'list' ? ' discovery-map-panel--inactive' : ''}`} inert={mode !== 'map' || undefined} aria-hidden={mode !== 'map' || undefined}>
        <section aria-labelledby="discovery-map-heading" className="discovery-map-entry">
          <div className="discovery-map-entry__heading">
            <div><h2 id="discovery-map-heading">Find your next stop.</h2><p>Explore events around the Bay.</p></div>

          </div>
          <div className="discovery-map-entry__preview">
            {mapPreview ?? <DiscoveryMapPreview />}
          </div>
        </section>

        </div>
        <div id="discovery-list-panel" hidden={mode !== 'list'} inert={mode !== 'list' || undefined}>
        {regionFallback ? <p className="discovery-notice" role="status">The map is unavailable. Showing Bay Area results.</p> : null}
        <section aria-labelledby="discovery-results-heading" className="discovery-results" id="discovery-results">
          {highlight ? <div className="discovery-feature-row">
            <EventLink eventHref={eventHref} item={highlight} publicSearch={publicSearch} variant="hero" />
          </div> : null}
          <div className="discovery-results__heading">
            <h2 ref={resultsHeading} tabIndex={-1} id="discovery-results-heading">{regionFallback ? 'Events in the Bay Area' : 'Events in this area'}</h2>
            <span>{windowLabel}</span>{onBroadenArea ? <button type="button" onClick={onBroadenArea} disabled={!canBroadenArea}>Zoom out to search a wider area</button> : null}
            <button disabled={retryDelayed} onClick={onRefresh} type="button">Refresh</button>
          </div>
          {status === 'ready' && feedback !== 'checking' && feedback !== 'error' ? <p aria-label="Discovery results" aria-live="polite" className="discovery-visually-hidden" role="status">{items.length} {items.length === 1 ? 'event' : 'events'}</p> : null}
          {notice && feedback !== 'checking' && feedback !== 'error' ? <p aria-live="polite" className="discovery-notice" role="status">{notice}</p> : null}
          {invalidItemCount > 0 && feedback !== 'checking' && feedback !== 'error' ? (
            <p aria-live="polite" className="discovery-notice">
              {invalidItemCount} {invalidItemCount === 1 ? 'event could' : 'events could'} not be shown. More events may be available.
            </p>
          ) : null}

          {feedback === 'checking' ? <LoadingResults refreshing={isRefreshing} /> : null}
          {feedback === 'error' ? <ErrorResults errorKind={errorKind} retryAfterSeconds={retryAfterSeconds} onRetry={onRetry} /> : null}
          {feedback === 'partial' ? <section aria-live="polite" className="discovery-results-state" role="status">
            <p className="discovery-state-title">More events may be available.</p>
            <p>{hasMore ? 'Load more to check for upcoming events.' : 'Refresh to check for events that could not be shown.'}</p>
          </section> : null}
          {feedback === 'empty' ? (
            <section aria-live="polite" className="discovery-results-state" role="status">
              <p className="discovery-state-title">{filtered ? 'No events match these filters in this area.' : 'No events in this map area yet.'}</p>
              <p>{filtered ? 'Try changing the date, category, or admission type.' : 'Zoom out to explore more of the Bay Area.'}</p>
              {nondefaultFilters ? <div className="discovery-state-actions">
                <button className="discovery-state-action" onClick={() => changeEmptyFilters(defaultDiscoveryFilters)} type="button">Clear filters</button>
                {filters.when === 'today' ? <button className="discovery-state-action" onClick={() => changeEmptyFilters({ ...filters, when: 'next7' })} type="button">See Next 7 Days</button> : null}
              </div> : null}
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
          {status === 'ready' && items.length > 0 && !hasMore && !moreError && invalidItemCount === 0 && !isRefreshing && !isRefreshError ? <p className="discovery-end">That’s everything coming up.</p> : null}
        </section>
        </div>
        </div>
        </div>
        <nav aria-label="Explore more events" className="discovery-shortcuts">
          {shortcuts.map(([title, description, destination]) => <Link key={title} to={destination}>
            <span><strong>{title}</strong><span>{description}</span></span><ArrowMark />
          </Link>)}
        </nav>
      </div>
    </main>
  )
}
