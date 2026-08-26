import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createConnectAccountSession, getConnectStatus } from './payment.api'

export const paymentKeys = {
  all: ['payments'] as const,
  connect: (userId: string) => ['payments', 'connect', userId] as const,
}

export function useConnectStatus(userId: string) {
  return useQuery({
    queryKey: paymentKeys.connect(userId),
    queryFn: getConnectStatus,
    enabled: userId.length > 0,
  })
}

export function useConnectAccountSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (initiatingUserId: string) => {
      if (initiatingUserId.length === 0) throw new Error('Missing organizer identity')
      return createConnectAccountSession()
    },
    onSuccess: (session, initiatingUserId) => {
      queryClient.setQueryData(paymentKeys.connect(initiatingUserId), session.status)
    },
  })
}
