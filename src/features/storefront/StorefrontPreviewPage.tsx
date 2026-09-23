import { captureIdentityLifetime } from '../auth/identityLifetime'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { readPreview } from './storefront.editor.api'
import { StorefrontView } from './StorefrontView'
import type { StorefrontCursor } from './storefront.schemas'
export function StorefrontPreviewPage() {
  const session = useSession()
  if (session.status !== 'authenticated') {
    return <p>Sign in to preview your storefront.</p>
  }
  return (
    <Preview
      key={`${session.user.id}:${session.identityVersion}`}
      userId={session.user.id}
    />
  )
}
function Preview({ userId }: { userId: string }) {
  const client = useQueryClient()
  const query = useInfiniteQuery({
    queryKey: ['organizer-settings', 'storefront-preview', userId],
    initialPageParam: null as StorefrontCursor | null,
    queryFn: async ({ pageParam }) => {
      const valid = captureIdentityLifetime(client, userId)
      const value = await readPreview(pageParam)
      if (!valid()) throw new Error('Session changed')
      return value
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    gcTime: 0,
    retry: false,
    staleTime: 0,
  })
  const first = query.data?.pages[0]
  const events = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.events) ?? []).filter((event) =>
        event.id !== first?.featured?.id
      ).map((event) => [event.id, event]),
    ).values(),
  ]
  return (
    <>
      <p role='status' className='storefront-preview-notice'>
        Private preview ·{' '}
        <Link to='/organizer/settings/storefront'>Back to editor</Link>
      </p>
      {query.isPending
        ? <p>Loading preview…</p>
        : query.isError
        ? (
          <p role='alert'>
            Preview could not load.{' '}
            <button onClick={() => void query.refetch()}>Try again</button>
          </p>
        )
        : first
        ? (
          <StorefrontView
            data={{ ...first, events }}
            ownerId={userId}
            more={query.hasNextPage
              ? (
                <button
                  className='storefront-more'
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  Load more events
                </button>
              )
              : null}
          />
        )
        : null}
    </>
  )
}
