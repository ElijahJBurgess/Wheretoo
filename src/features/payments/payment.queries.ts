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

export function useConnectAccountSession(userId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createConnectAccountSession,
    onSuccess: (session) => {
      queryClient.setQueryData(paymentKeys.connect(userId), session.status)
    },
  })
}
