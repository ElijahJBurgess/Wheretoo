import { useQuery } from '@tanstack/react-query'
import { getRefundStatus, isRefundAccessDenied } from './refunds.api'
import type { RefundStatus } from './refunds.schemas'
export const refundKeys = {
 status: (ownerId: string, eventId: string, orderId: string) => ['organizer-operations', ownerId, eventId, 'refund-status', orderId] as const,
 notice: (ownerId: string, eventId: string, orderId: string) => ['organizer-operations', ownerId, eventId, 'refund-notice', orderId] as const,
}
export function refundPollInterval(data: RefundStatus | undefined, error: unknown) {
 return isRefundAccessDenied(error) ? false : data && ['submitting', 'processing', 'unknown'].includes(data.state) ? 5000 : false
}
export function useRefundStatus(ownerId: string, eventId: string, orderId: string, stopped = false) {
 return useQuery({ queryKey: refundKeys.status(ownerId, eventId, orderId), queryFn: ({ signal }) => getRefundStatus(eventId, orderId, signal), enabled: query => !!ownerId && !!eventId && !!orderId && !stopped && !isRefundAccessDenied(query.state.error),
  retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnReconnect: query => !stopped && !isRefundAccessDenied(query.state.error), refetchOnWindowFocus: query => !stopped && !isRefundAccessDenied(query.state.error),
  refetchInterval: query => stopped ? false : refundPollInterval(query.state.data, query.state.error), refetchIntervalInBackground: false,
 })
}
