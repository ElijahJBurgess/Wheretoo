import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { eventKeys } from '../events/event.queries'
import { paymentKeys } from '../payments/payment.queries'
import { activatePaidSales, listOwnedTicketTiers, saveTicketTiers } from './ticket.api'
import type { TicketTiersInput } from './ticket.types'

export const ticketKeys = {
  all: ['tickets'] as const,
  owned: (organizerId: string, eventId: string) => ['tickets', 'owned', organizerId, eventId] as const,
  public: (eventId: string) => ['tickets', 'public', eventId] as const,
}

export function useOwnedTicketTiers(organizerId: string, eventId: string) {
  return useQuery({
    queryKey: ticketKeys.owned(organizerId, eventId),
    queryFn: () => listOwnedTicketTiers(eventId),
    enabled: organizerId.length > 0 && eventId.length > 0,
  })
}

export function useSaveTicketTiers(organizerId: string, eventId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tiers: TicketTiersInput) => saveTicketTiers(eventId, tiers),
    onSuccess: async (tiers) => {
      if (tiers.some((tier) => tier.event_id !== eventId)) {
        throw new Error('Ticket tiers returned for a different event')
      }
      queryClient.setQueryData(ticketKeys.owned(organizerId, eventId), tiers)
      await queryClient.invalidateQueries({ queryKey: ticketKeys.public(eventId), exact: true })
    },
  })
}

export function useActivatePaidSales(organizerId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: activatePaidSales,
    onSuccess: async (event, requestedEventId) => {
      if (event.id !== requestedEventId || event.organizer_id !== organizerId) {
        throw new Error('Organizer identity changed')
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventKeys.ownedList(organizerId), exact: true }),
        queryClient.invalidateQueries({ queryKey: eventKeys.detail(organizerId, requestedEventId), exact: true }),
        queryClient.invalidateQueries({ queryKey: ticketKeys.owned(organizerId, requestedEventId), exact: true }),
        queryClient.invalidateQueries({ queryKey: ticketKeys.public(requestedEventId), exact: true }),
        queryClient.invalidateQueries({ queryKey: paymentKeys.connect(organizerId), exact: true }),
      ])
    },
  })
}
