import { useQuery } from '@tanstack/react-query'
import { getPublicEventTicketing } from './publicTicketing.api'
import { ticketKeys } from './ticket.queries'

export function usePublicTicketingEvent(eventId: string) {
  const publicEventId = eventId.trim().toLowerCase()

  return useQuery({
    queryKey: ticketKeys.public(publicEventId),
    queryFn: () => getPublicEventTicketing(publicEventId),
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
