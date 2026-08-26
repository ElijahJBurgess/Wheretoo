import { usePublicTicketingEvent } from '../tickets/publicTicketing.queries'

export function useCheckoutPublicEvent(eventId: string) {
  return usePublicTicketingEvent(eventId)
}
