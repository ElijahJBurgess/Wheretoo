import { useQuery } from '@tanstack/react-query'
import { useSession } from '../auth/SessionProvider'
import { getEventCoverState, listEventImages } from './eventImages.api'

export function useEventImages(ids: readonly string[]) {
  const session = useSession()
  const eventIds = [...new Set(ids.filter(Boolean))].sort()
  return useQuery({
    queryKey: ['event-images', session.user?.id ?? 'public', session.identityVersion, eventIds],
    queryFn: () => listEventImages(eventIds),
    enabled: eventIds.length > 0 && session.status !== 'loading' && session.status !== 'unavailable',
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 40_000,
    retry: false,
  })
}

export function useEventCoverState(eventId: string) {
  const session = useSession()
  return useQuery({
    queryKey: ['event-images', 'cover-state', session.user?.id, session.identityVersion, eventId],
    queryFn: () => getEventCoverState(eventId),
    enabled: !!eventId && session.status === 'authenticated',
    staleTime: 0, gcTime: 0, refetchInterval: 40_000, retry: false,
  })
}
