import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getFreeRegistration, getFreeRegistrationMetrics, listFreeAdmissions } from './freeOperations.api'
import { type FreeAdmissionCursor, isFreeEventAdmissionOpen } from './freeOperations.schemas'
import { operationsKeys } from './operations.queries'

export const freeOperationsKeys = {
  source: (ownerId: string, eventId: string, identityVersion: number) =>
    [...operationsKeys.event(ownerId, eventId), 'source', 'free_registration', identityVersion] as const,
}

export { isFreeEventAdmissionOpen }

export function useFreeRegistrationMetrics(ownerId: string, eventId: string, identityVersion = 0) {
  return useQuery({
    queryKey: [...freeOperationsKeys.source(ownerId, eventId, identityVersion), 'metrics'],
    queryFn: ({ signal }) => getFreeRegistrationMetrics(eventId, signal),
    enabled: !!ownerId && !!eventId,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  })
}

export function useFreeAdmissions(ownerId: string, eventId: string, identityVersion: number, search: string) {
  return useInfiniteQuery({
    queryKey: [...freeOperationsKeys.source(ownerId, eventId, identityVersion), 'admissions', search],
    initialPageParam: null as FreeAdmissionCursor | null,
    queryFn: ({ pageParam, signal }) => listFreeAdmissions(eventId, search, pageParam, signal),
    getNextPageParam: page => page.nextCursor,
    enabled: !!ownerId && !!eventId && !!search.trim(),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  })
}

export function useFreeRegistration(ownerId: string, eventId: string, identityVersion: number, registrationId: string) {
  return useQuery({
    queryKey: [...freeOperationsKeys.source(ownerId, eventId, identityVersion), 'registration', registrationId],
    queryFn: ({ signal }) => getFreeRegistration(eventId, registrationId, signal),
    enabled: !!ownerId && !!eventId && !!registrationId,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    gcTime: 0,
  })
}
