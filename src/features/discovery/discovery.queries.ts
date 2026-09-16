import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { DiscoveryReadError, getDiscoveryPage } from './discovery.api'
import { serializeDiscoveryFilters } from './discovery.filters'
import { nextDiscoveryMidnight } from './discovery.time'
import type { DiscoveryFilters, DiscoveryPageData } from './discovery.types'

type Feed = { pages: DiscoveryPageData[]; receivedAt: number; readId: number }
type MoreState = { search: string; readId?: number; loading?: boolean; error?: DiscoveryReadError; notice?: string }
type PendingAppend = { controller: AbortController; readId: number; phase: 'append' | 'restart' }
let nextReadId = 0
export const discoveryKeys = { list: (search: string) => ['public-discovery', 'v1', search] as const }

function releaseObsoleteAppend(pending: RefObject<PendingAppend | null>, readId: number | undefined) {
  const request = pending.current
  if (request?.phase === 'append' && request.readId !== readId) {
    pending.current = null
    request.controller.abort()
  }
}

async function readFirstPage(filters: DiscoveryFilters, signal: AbortSignal, received: (time: number) => void, blocked: (until: number) => void): Promise<Feed> {
  try {
    const page = await getDiscoveryPage(filters, { signal })
    const receivedAt = Date.now()
    received(receivedAt)
    // Structural sharing can preserve identical page objects after a refresh.
    // This in-memory generation still distinguishes each authoritative read.
    return { pages: [page], receivedAt, readId: ++nextReadId }
  } catch (error) {
    if (!signal.aborted && error instanceof DiscoveryReadError && error.kind === 'rate_limited') {
      const receivedAt = Date.now()
      blocked(receivedAt + error.retryAfterSeconds * 1000)
      received(receivedAt)
    }
    throw error
  }
}

export function useDiscovery(filters: DiscoveryFilters) {
  const client = useQueryClient()
  const search = serializeDiscoveryFilters(filters)
  const [more, setMore] = useState<MoreState>({ search })
  // Transient requests belong to a visit, unlike the reusable public feed.
  if (more.search !== search) setMore({ search })
  const [blockedUntil, setBlockedUntil] = useState(0)
  const [clock, setClock] = useState(() => Date.now())
  const append = useRef<PendingAppend | null>(null)
  const blocked = clock < blockedUntil
  const query = useQuery({
    queryKey: discoveryKeys.list(search),
    queryFn: ({ signal }) => readFirstPage(filters, signal, setClock, setBlockedUntil),
    staleTime: 60_000, gcTime: 600_000, retry: false,
    // A cached chain is replaced by a fresh first page. Never refetch every cursor.
    refetchOnMount: !blocked, refetchOnWindowFocus: !blocked, refetchOnReconnect: !blocked,
  })
  const activeMore = more.search === search && more.readId === query.data?.readId ? more : { search }
  const failure = activeMore.error ?? (query.error instanceof DiscoveryReadError ? query.error : undefined)

  useEffect(() => () => { append.current?.controller.abort(); append.current = null }, [search])
  useEffect(() => { releaseObsoleteAppend(append, query.data?.readId) }, [query.data?.readId])
  useEffect(() => {
    if (!blockedUntil) return
    // A local countdown only while throttled; it never sends another request.
    const countdown = setInterval(() => setClock(Date.now()), 1000)
    const timer = setTimeout(() => { clearInterval(countdown); setClock(Date.now()); setBlockedUntil(0) }, Math.max(0, blockedUntil - Date.now()))
    return () => { clearInterval(countdown); clearTimeout(timer) }
  }, [blockedUntil])
  useEffect(() => {
    const update = () => setClock(Date.now())
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => { window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update) }
  }, [])

  async function refresh() {
    if (Date.now() < blockedUntil) return
    append.current?.controller.abort(); append.current = null
    setMore({ search })
    await query.refetch()
  }

  const feed = query.data
  const first = feed?.pages[0]
  const serverNow = first && feed ? Date.parse(first.serverNow) + Math.max(0, clock - feed.receivedAt) : 0
  const allItems = feed?.pages.flatMap(page => page.items) ?? []
  const seen = new Set<string>()
  const items = allItems.filter(item => {
    if (seen.has(item.id) || Date.parse(item.endsAt) <= serverNow) return false
    seen.add(item.id); return true
  })
  const nearestEnd = items.reduce((end, item) => Math.min(end, Date.parse(item.endsAt)), Infinity)
  const midnight = serverNow ? nextDiscoveryMidnight(serverNow) : Infinity
  useEffect(() => {
    if (!Number.isFinite(midnight)) return
    const timer = setTimeout(() => {
      setClock(Date.now())
      if (midnight <= nearestEnd && Date.now() >= blockedUntil) {
        append.current?.controller.abort(); append.current = null
        setMore({ search })
        void client.invalidateQueries({ queryKey: discoveryKeys.list(search), exact: true })
      }
    }, Math.max(1, Math.min(midnight, nearestEnd) - serverNow + 25))
    return () => clearTimeout(timer)
  }, [client, search, midnight, nearestEnd, serverNow, blockedUntil])

  async function loadMore() {
    const cursor = feed?.pages.at(-1)?.nextCursor
    const currentReadId = client.getQueryData<Feed>(discoveryKeys.list(search))?.readId
    // A user can activate Load more before the read-change effect has run.
    releaseObsoleteAppend(append, currentReadId)
    if (!feed || feed.readId !== currentReadId || !cursor || append.current || query.isFetching || Date.now() < blockedUntil) return
    const controller = new AbortController()
    const request: PendingAppend = { controller, readId: feed.readId, phase: 'append' }
    append.current = request
    setMore({ search, readId: feed.readId, loading: true })
    try {
      const page = await getDiscoveryPage(filters, { cursor, signal: controller.signal })
      if (controller.signal.aborted) return
      const key = discoveryKeys.list(search)
      const state = client.getQueryState<Feed>(key)
      // A focus refresh can supersede this append without going through refresh().
      if (state?.data?.readId !== feed.readId) return
      client.setQueryData<Feed>(key, { ...feed, pages: [...feed.pages, page] }, { updatedAt: state.dataUpdatedAt })
      setMore({ search, readId: feed.readId })
    } catch (error) {
      if (controller.signal.aborted) return
      const readError = error instanceof DiscoveryReadError ? error : new DiscoveryReadError('unavailable')
      if (readError.kind === 'rate_limited') {
        setBlockedUntil(Date.now() + readError.retryAfterSeconds * 1000)
        setClock(Date.now())
      }
      if (readError.kind === 'cursor') {
        // This request owns the replacement read and its recovery notice.
        request.phase = 'restart'
        const refreshed = await query.refetch()
        if (!controller.signal.aborted) setMore({ search, readId: refreshed.data?.readId, notice: 'The event list was updated. Showing the first page.' })
      } else setMore({ search, readId: feed.readId, error: readError })
    } finally {
      if (append.current === request) {
        append.current = null
        setMore(current => current.search === search && current.readId === feed.readId ? { ...current, loading: false } : current)
      }
    }
  }

  const retryAfterSeconds = Math.max(0, Math.ceil((blockedUntil - clock) / 1000))
  return {
    items, status: feed ? 'ready' as const : query.isError ? 'error' as const : 'loading' as const,
    highlightItems: items.filter(item => first?.items.some(candidate => candidate.id === item.id)),
    errorKind: failure?.kind === 'invalid_response' ? 'invalid_response' as const : failure?.kind === 'rate_limited' ? 'rate_limited' as const : 'unavailable' as const,
    hasMore: Boolean(feed?.pages.at(-1)?.nextCursor), isLoadingMore: Boolean(activeMore.loading), isRefreshing: query.isFetching && Boolean(feed),
    moreError: activeMore.error ? (activeMore.error.kind === 'rate_limited' ? 'Please wait before loading more events.' : 'More events could not load. Try again.') : null,
    notice: query.isError && feed ? 'Couldn’t refresh events. Showing the last results we received.' : activeMore.notice ?? (query.isFetching && feed ? 'Refreshing events…' : null),
    invalidItemCount: feed?.pages.reduce((sum, page) => sum + page.invalidItemCount, 0) ?? 0,
    retryAfterSeconds, refresh, loadMore,
  }
}
