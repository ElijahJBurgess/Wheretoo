import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getOrganizer, saveOrganizer } from './organizer.api'
import type { OrganizerInput } from './organizer.schemas'

export const organizerKeys = {
  all: ['organizer'] as const,
  detail: (userId: string) => ['organizer', userId] as const,
}

export function useOrganizer(userId: string) {
  return useQuery({
    queryKey: organizerKeys.detail(userId),
    queryFn: () => getOrganizer(userId),
    enabled: userId.length > 0,
  })
}

export function useSaveOrganizer(userId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: OrganizerInput) => saveOrganizer(userId, input),
    onSuccess: (organizer) => {
      queryClient.setQueryData(organizerKeys.detail(userId), organizer)
    },
  })
}
