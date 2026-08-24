import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getOwnedEvent, listOwnedEvents, publishEvent, saveEventDraft } from './event.api'

export const eventKeys = {
  all: ['events'] as const,
  ownedList: (organizerId: string) => ['events', 'owned', organizerId] as const,
  detail: (eventId: string) => ['events', 'detail', eventId] as const,
}

export function useOwnedEvents(organizerId: string) {
  return useQuery({
    queryKey: eventKeys.ownedList(organizerId),
    queryFn: () => listOwnedEvents(organizerId),
    enabled: organizerId.length > 0,
  })
}

export function useOwnedEvent(eventId: string, organizerId: string) {
  return useQuery({
    queryKey: eventKeys.detail(eventId),
    queryFn: () => getOwnedEvent(eventId, organizerId),
    enabled: eventId.length > 0 && organizerId.length > 0,
  })
}

export function useSaveEventDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveEventDraft,
    onSuccess: async (event) => {
      queryClient.setQueryData(eventKeys.detail(event.id), event)
      await queryClient.invalidateQueries({
        queryKey: eventKeys.ownedList(event.organizer_id),
        exact: true,
      })
    },
  })
}

export function usePublishEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: publishEvent,
    onSuccess: async (event) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: eventKeys.ownedList(event.organizer_id),
          exact: true,
        }),
        queryClient.invalidateQueries({ queryKey: eventKeys.detail(event.id), exact: true }),
      ])
    },
  })
}
