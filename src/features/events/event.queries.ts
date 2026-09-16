import { captureIdentityLifetime } from '../auth/identityLifetime'
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
    mutationKey: ['events', 'cancel', organizerId],
    gcTime: 0,
    onMutate: () => ({ isCurrent: captureIdentityLifetime(queryClient, organizerId) }),
    mutationFn: cancelOwnedEvent,
    retry: false,
    onSuccess: async (event, eventId, lifetime) => {
      if (!lifetime?.isCurrent()) return
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

type OwnedEventQueryOptions = {
  revalidateOnMount?: boolean
}

export function useOwnedEvent(
  eventId: string,
  organizerId: string,
  options?: OwnedEventQueryOptions,
) {
  return useQuery({
    queryKey: eventKeys.detail(organizerId, eventId),
    queryFn: () => getOwnedEvent(eventId, organizerId),
    enabled: eventId.length > 0 && organizerId.length > 0,
    ...(options?.revalidateOnMount
      ? { staleTime: 0, refetchOnMount: 'always' as const }
      : {}),
  })
}

export function useSaveEventDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['events', 'save-draft'],
    gcTime: 0,
    onMutate: (input) => ({ isCurrent: captureIdentityLifetime(queryClient, input.organizerId) }),
    mutationFn: saveEventDraft,
    onSuccess: async (event, input, lifetime) => {
      if (!lifetime?.isCurrent()) return
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
    mutationKey: ['events', 'save-revision'],
    gcTime: 0,
    onMutate: (input) => ({ isCurrent: captureIdentityLifetime(queryClient, input.organizerId) }),
    mutationFn: saveEventRevision,
    onSuccess: async (event, input, lifetime) => {
      if (!lifetime?.isCurrent()) return
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
