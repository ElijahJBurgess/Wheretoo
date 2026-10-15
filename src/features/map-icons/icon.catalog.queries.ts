import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getOwnedEventMapIcon, listSelectableMapIcons } from './icon.catalog.api'

export function useSelectableMapIcons(organizerId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['map-icons', 'catalog', organizerId],
    queryFn: ({ pageParam }) => listSelectableMapIcons(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: page => page.nextCursor,
    enabled: enabled && organizerId.length > 0,
    staleTime: 0, gcTime: 0, refetchOnWindowFocus: true, refetchInterval: 60000,
    refetchIntervalInBackground: false, retry: false,
  })
}

export function useOwnedMapIcon(organizerId: string, eventId?: string, enabled = true) {
  return useQuery({
    queryKey: ['map-icons', 'assignment', organizerId, eventId],
    queryFn: () => getOwnedEventMapIcon(eventId!),
    enabled: enabled && !!eventId && !!organizerId,
    staleTime: 0, gcTime: 0, refetchOnWindowFocus: true, refetchInterval: 60000,
    refetchIntervalInBackground: false, retry: false,
  })
}
