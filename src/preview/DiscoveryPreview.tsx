import { useMemo, useState } from 'react'
import { DiscoveryView } from '../features/discovery/DiscoveryView'
import { defaultDiscoveryFilters, serializeDiscoveryFilters } from '../features/discovery/discovery.filters'
import type { DiscoveryFilters } from '../features/discovery/discovery.types'
import { discoveryPreviewClock, discoveryPreviewItems } from './discoveryFixtures'
import './discovery-preview.css'

type PreviewMode = 'ready' | 'loading' | 'mixed' | 'empty' | 'rate-limited' | 'unavailable' | 'malformed' | 'paging' | 'append-error' | 'image-failure' | 'long-title'

const previewModes: readonly [PreviewMode, string][] = [
  ['ready', 'Ready'], ['loading', 'Loading'], ['mixed', 'Malformed mix'],
  ['empty', 'Empty'], ['rate-limited', 'Rate limited'], ['unavailable', 'Unavailable'],
  ['malformed', 'Malformed response'], ['paging', 'Paging'], ['append-error', 'Append error'],
  ['image-failure', 'Image failure'], ['long-title', 'Long title'],
]

function laDay(value: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value))
}

function previewMatches(filters: DiscoveryFilters) {
  const today = laDay(discoveryPreviewClock)
  const friday = new Date(`${today}T12:00:00Z`)
  friday.setUTCDate(friday.getUTCDate() + 5 - (friday.getUTCDay() || 7))
  const monday = new Date(friday)
  monday.setUTCDate(monday.getUTCDate() + 3)
  const weekendStart = friday.toISOString().slice(0, 10)
  const weekendEnd = monday.toISOString().slice(0, 10)
  return discoveryPreviewItems.filter((item) => {
    const date = laDay(item.startsAt)
    const dateMatch = filters.when === 'upcoming' || (filters.when === 'today' ? date === today : date >= weekendStart && date < weekendEnd)
    return dateMatch && (!filters.category || item.category === filters.category) && (!filters.price || item.admissionType === filters.price)
  })
}

export function DiscoveryPreview() {
  const [filters, setFilters] = useState<DiscoveryFilters>(defaultDiscoveryFilters)
  const [mode, setMode] = useState<PreviewMode>('ready')
  const [expanded, setExpanded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const matches = useMemo(() => previewMatches(filters), [filters])
  const pagingItems = expanded ? matches : matches.slice(0, 2)
  const failedImageItems = matches.map((item, index) => index === 0 ? { ...item, artworkReference: '/preview/missing-discovery-artwork.jpg' } : item)
  const items = mode === 'paging' ? pagingItems
    : mode === 'empty' || mode === 'loading' || mode === 'rate-limited' || mode === 'unavailable' || mode === 'malformed' ? []
      : mode === 'image-failure' ? failedImageItems
        : mode === 'long-title' ? matches.slice(-1)
          : matches
  const isError = mode === 'rate-limited' || mode === 'unavailable' || mode === 'malformed'

  return (
    <div className="discovery-preview">
      <aside aria-label="Discovery preview controls" className="discovery-preview__controls">
        <p><strong>Spec 13 preview</strong><span>Fixed clock · {discoveryPreviewClock.toISOString()}</span></p>
        <div>{previewModes.map(([value, label]) => (
          <button aria-pressed={mode === value} key={value} onClick={() => { setMode(value); setExpanded(false); setNotice(null) }} type="button">{label}</button>
        ))}</div>
      </aside>
      <DiscoveryView
        errorKind={mode === 'rate-limited' ? 'rate_limited' : mode === 'malformed' ? 'invalid_response' : mode === 'unavailable' ? 'unavailable' : undefined}
        eventHref={() => '/preview/event-page'}
        filters={filters}
        hasMore={(mode === 'paging' && !expanded && matches.length > 2) || mode === 'append-error'}
        highlightItems={mode === 'paging' ? matches.slice(0, 2) : items}
        invalidItemCount={mode === 'mixed' ? 2 : 0}
        isLoadingMore={false}
        items={items}
        moreError={mode === 'append-error' ? 'Could not load more events.' : null}
        notice={notice}
        onFiltersChange={(next) => { setFilters(next); setMode('ready'); setExpanded(false); setNotice(null) }}
        onLoadMore={() => setExpanded(true)}
        onRefresh={() => setNotice('Events refreshed at the fixed preview time.')}
        onRetry={() => setMode('ready')}
        publicSearch={serializeDiscoveryFilters(filters)}
        retryAfterSeconds={mode === 'rate-limited' ? 45 : undefined}
        status={mode === 'loading' ? 'loading' : isError ? 'error' : 'ready'}
      />
    </div>
  )
}
