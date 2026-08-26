import { useQuery } from '@tanstack/react-query'
import { getPublicEventTicketing } from './publicTicketing.api'
import { ticketKeys } from './ticket.queries'

export function usePublicTicketingEvent(eventId: string) {
  const publicEventId = eventId.trim().toLowerCase()

  return useQuery({
    queryKey: ticketKeys.public(publicEventId),
    queryFn: () => getPublicEventTicketing(publicEventId),
    enabled: publicEventId.length > 0,
  })
}
