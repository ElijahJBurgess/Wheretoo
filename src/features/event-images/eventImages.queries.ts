import { useQuery } from '@tanstack/react-query'
import { useSession } from '../auth/SessionProvider'
import { listEventImages } from './eventImages.api'

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
