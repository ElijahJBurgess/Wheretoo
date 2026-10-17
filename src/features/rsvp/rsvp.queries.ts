import { useQuery } from '@tanstack/react-query'
import { rsvpApi } from './rsvp.api'

export function useFreeRsvpEvent(eventId: string) {
  const publicEventId = eventId.trim().toLowerCase()
  return useQuery({
    queryKey: ['rsvp', 'public', publicEventId],
    queryFn: () => rsvpApi.event(publicEventId),
    enabled: publicEventId.length > 0,
    retry: false,
    staleTime: 0,
    refetchInterval: () => (
      typeof document === 'undefined' || document.visibilityState === 'visible' ? 15_000 : false
    ),
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  })
}
