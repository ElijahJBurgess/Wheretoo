import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getOrganizer, saveOrganizer } from './organizer.api'
import type { OrganizerInput } from './organizer.schemas'
import { captureIdentityLifetime } from '../auth/identityLifetime'

export const organizerKeys = {
  all: ['organizer'] as const,
  detail: (userId: string) => ['organizer', userId] as const,
}

const freshJwtRetryLimit = 20

export function shouldRetryOrganizerQuery(failureCount: number, error: unknown): boolean {
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? (error as { message?: unknown }).message
    : undefined
  return failureCount < freshJwtRetryLimit && message === 'JWT issued at future'
}

export function useOrganizer(userId: string) {
  return useQuery({
    queryKey: organizerKeys.detail(userId),
    queryFn: () => getOrganizer(userId),
    enabled: userId.length > 0,
    retry: shouldRetryOrganizerQuery,
    retryDelay: 1_000,
  })
}

export function useSaveOrganizer(userId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['organizer', 'save', userId],
    gcTime: 0,
    onMutate: () => ({ isCurrent: captureIdentityLifetime(queryClient, userId) }),
    mutationFn: (input: OrganizerInput) => {
      if (!captureIdentityLifetime(queryClient, userId)()) throw new Error('Organizer session changed')
      return saveOrganizer(userId, input)
    },
    onSuccess: (organizer, _input, lifetime) => {
      if (!lifetime?.isCurrent()) return
      queryClient.setQueryData(organizerKeys.detail(userId), organizer)
    },
  })
}
