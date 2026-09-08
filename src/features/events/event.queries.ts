import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { moderationKeys } from '../moderation/moderation.queries'
import { ticketKeys } from '../tickets/ticket.queries'
import { cancelOwnedEvent, getOwnedEvent, listOwnedEvents, publishEvent, saveEventDraft, saveEventRevision } from './event.api'

export const eventKeys = {
  all: ['events'] as const,
  ownedList: (organizerId: string) => ['events', 'owned', organizerId] as const,
  detail: (organizerId: string, eventId: string) =>
    ['events', 'detail', organizerId, eventId] as const,
}

export function useOwnedEvents(organizerId: string) {
  return useQuery({
    queryKey: eventKeys.ownedList(organizerId),
    queryFn: () => listOwnedEvents(organizerId),
    enabled: organizerId.length > 0,
  })
}

export function useCancelOwnedEvent(organizerId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: cancelOwnedEvent,
    retry: false,
    onSuccess: async (event, eventId) => {
      if (event.id === eventId && event.organizer_id === organizerId) {
        queryClient.setQueryData(eventKeys.detail(organizerId, eventId), event)
      }
      await Promise.all([
        eventKeys.detail(organizerId, eventId), eventKeys.ownedList(organizerId),
        moderationKeys.publicEvent(eventId), ticketKeys.public(eventId),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey, exact: true })))
    },
  })
}

export function useOwnedEvent(eventId: string, organizerId: string) {
  return useQuery({
    queryKey: eventKeys.detail(organizerId, eventId),
    queryFn: () => getOwnedEvent(eventId, organizerId),
    enabled: eventId.length > 0 && organizerId.length > 0,
  })
}

export function useSaveEventDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveEventDraft,
    onSuccess: async (event, input) => {
      if (event.organizer_id === input.organizerId) {
        queryClient.setQueryData(eventKeys.detail(input.organizerId, event.id), event)
      }
      await queryClient.invalidateQueries({
        queryKey: eventKeys.ownedList(input.organizerId),
        exact: true,
      })
    },
  })
}

export function useSaveEventRevision() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveEventRevision,
    onSuccess: async (event, input) => {
      if (event.id === input.eventId && event.organizer_id === input.organizerId) {
        queryClient.setQueryData(eventKeys.detail(input.organizerId, input.eventId), event)
      }
      await queryClient.invalidateQueries({
        queryKey: eventKeys.ownedList(input.organizerId),
        exact: true,
      })
    },
  })
}

export function usePublishEvent(organizerId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: publishEvent,
    onSuccess: async (event, requestedEventId) => {
      const contracts = [
        eventKeys.ownedList(organizerId),
        eventKeys.detail(organizerId, requestedEventId),
      ]
      if (event.organizer_id !== organizerId) {
        contracts.push(eventKeys.ownedList(event.organizer_id))
      }
      if (event.organizer_id !== organizerId || event.id !== requestedEventId) {
        contracts.push(eventKeys.detail(event.organizer_id, event.id))
      }

      await Promise.all(
        contracts.map((queryKey) => queryClient.invalidateQueries({ queryKey, exact: true })),
      )
    },
  })
}
