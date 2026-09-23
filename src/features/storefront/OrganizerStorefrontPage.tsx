import { useEffect } from 'react'
import { visitStorefront } from './storefront.attribution'
import { useParams, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { readStorefront } from './storefront.api'
import type { StorefrontCursor } from './storefront.schemas'
import { StorefrontView } from './StorefrontView'
export function OrganizerStorefrontPage() {
  const { organizerHandle = '' } = useParams()
  const [params] = useSearchParams()
  const ref = params.get('ref')
  const query = useInfiniteQuery({
    queryKey: ['public-storefront', organizerHandle],
    initialPageParam: null as StorefrontCursor | null,
    queryFn: ({ pageParam }) => readStorefront(organizerHandle, pageParam),
    getNextPageParam: (page) => page?.nextCursor ?? undefined,
    retry: false,
    staleTime: 0,
  })
  useEffect(() => {
    const data = query.data
    if (!data?.pages[0]?.identity.handle) return
    try {
      visitStorefront(
        data.pages[0].identity.handle,
        ref,
        data.pages.flatMap(
          (p) => [
            ...(p?.featured ? [p.featured.id] : []),
            ...(p?.events.map((e) => e.id) ?? []),
          ],
        ),
      )
    } catch { /* Optional measurement. */ }
  }, [query.data, ref])
  if (query.isPending) {
    return (
      <main className='buyer-page storefront'>
        <p role='status'>Loading storefront…</p>
      </main>
    )
  }
  if (query.isError) {
    return (
      <main className='buyer-page storefront'>
        <p role='alert'>Storefront could not load.</p>
        <button onClick={() => void query.refetch()}>Try again</button>
      </main>
    )
  }
  const first = query.data.pages[0]
  if (!first) {
    return (
      <main className='buyer-page storefront'>
        <h1>Storefront not found</h1>
        <p>This organizer storefront is not available.</p>
      </main>
    )
  }
  const events = [
    ...new Map(
      query.data.pages.flatMap((page) => page?.events ?? []).filter((event) =>
        event.id !== first.featured?.id
      ).map((event) => [event.id, event]),
    ).values(),
  ]
  return (
    <StorefrontView
      data={{ ...first, events }}
      more={query.hasNextPage
        ? (
          <button
            className='storefront-more'
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more events'}
          </button>
        )
        : null}
    />
  )
}
