import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { fingerprintConfirmationToken, getOrderConfirmation, OrderApiError } from './order.api'
import type { OrderConfirmation } from './order.types'

const POLL_INTERVAL_MS = 1_000
const POLL_WINDOW_MS = 60_000

export const orderKeys = {
  confirmation: (tokenFingerprint: string) => ['orders', 'confirmation', tokenFingerprint] as const,
}

export function useOrderConfirmation(confirmationToken: string) {
  const [fingerprint, setFingerprint] = useState<string | null>(null)
  const [fingerprintNotFound, setFingerprintNotFound] = useState(false)
  const [deadline, setDeadline] = useState(() => Date.now() + POLL_WINDOW_MS)
  const [isTimedOut, setIsTimedOut] = useState(false)

  useEffect(() => {
    let active = true
    void fingerprintConfirmationToken(confirmationToken).then(
      (value) => {
        if (active) setFingerprint(value)
      },
      () => {
        if (active) setFingerprintNotFound(true)
      },
    )
    return () => { active = false }
  }, [confirmationToken])

  const query = useQuery<OrderConfirmation | null>({
    queryKey: orderKeys.confirmation(fingerprint ?? ''),
    queryFn: async () => {
      try {
        return await getOrderConfirmation(confirmationToken)
      } catch (error) {
        if (error instanceof OrderApiError && error.code === 'ORDER_NOT_FOUND') return null
        throw error
      }
    },
    enabled: fingerprint !== null,
    retry: false,
    refetchInterval: (current) => (
      !isTimedOut && current.state.data?.status === 'processing' ? POLL_INTERVAL_MS : false
    ),
  })

  useEffect(() => {
    if (fingerprint === null || query.data?.status !== 'processing' || isTimedOut) return
    const remaining = Math.max(0, deadline - Date.now())
    const timeout = window.setTimeout(() => setIsTimedOut(true), remaining)
    return () => window.clearTimeout(timeout)
  }, [deadline, fingerprint, isTimedOut, query.data?.status])

  const retry = useCallback(async () => {
    setDeadline(Date.now() + POLL_WINDOW_MS)
    setIsTimedOut(false)
    await query.refetch()
  }, [query])

  return {
    ...query,
    data: fingerprintNotFound ? null : query.data,
    isPending: !fingerprintNotFound && (fingerprint === null || query.isPending),
    isTimedOut,
    retry,
  }
}
