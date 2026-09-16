import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { createConnectAccountSession, getConnectStatus } from './payment.api'

export const paymentKeys = {
  all: ['payments'] as const,
  connect: (userId: string) => ['payments', 'connect', userId] as const,
}

export function useConnectStatus(userId: string, options: { fresh?: boolean } = {}) {
  const client = useQueryClient()
  return useQuery({
    queryKey: paymentKeys.connect(userId),
    queryFn: async () => {
      const current = captureIdentityLifetime(client, userId)
      if (!current()) throw new Error('Organizer session changed')
      const status = await getConnectStatus(userId, current)
      if (!current()) throw new Error('Organizer session changed')
      return status
    },
    ...(options.fresh ? { staleTime: 0, refetchOnMount: 'always' as const, retry: false } : {}),
    enabled: userId.length > 0,
  })
}

/** Account Session secrets belong only to the embedded component's in-memory lifecycle. */
export function useConnectAccountSession() {
  const queryClient = useQueryClient()
  const mounted = useRef(false)
  const pendingCount = useRef(0)
  const [isPending, setPending] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const mutateAsync = useCallback(async (initiatingUserId: string) => {
    const isCurrent = captureIdentityLifetime(queryClient, initiatingUserId)
    if (!isCurrent()) throw new Error('Organizer session changed')
    pendingCount.current += 1
    setPending(true)
    try {
      const session = await createConnectAccountSession(initiatingUserId, isCurrent)
      if (!mounted.current || !isCurrent()) throw new Error('Organizer session changed')
      queryClient.setQueryData(paymentKeys.connect(initiatingUserId), session.status)
      return session
    } finally {
      pendingCount.current -= 1
      if (mounted.current) setPending(pendingCount.current > 0)
    }
  }, [queryClient])
  return { isPending, mutateAsync }
}
