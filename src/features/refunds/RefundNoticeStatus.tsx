import { useQuery } from '@tanstack/react-query'
import { getRefundNotice, isRefundAccessDenied } from './refunds.api'
import { refundKeys } from './refunds.queries'
export function RefundNoticeStatus({ ownerId, eventId, orderId }: { ownerId: string; eventId: string; orderId: string }) {
 const query = useQuery({ queryKey: refundKeys.notice(ownerId, eventId, orderId), queryFn: ({ signal }) => getRefundNotice(eventId, orderId, signal), retry: false, gcTime: 0,
  refetchInterval: q => !isRefundAccessDenied(q.state.error) && q.state.data && ['not_requested', 'queued', 'sending'].includes(q.state.data.state) ? 5000 : false,
  refetchOnWindowFocus: q => !isRefundAccessDenied(q.state.error), refetchIntervalInBackground: false,
 })
 const result = query.isError ? undefined : query.data
 const label = !result ? 'Refund email status unavailable. The refund remains confirmed.'
  : ['bounced', 'complained', 'failed'].includes(result.observation ?? '') || ['failed', 'suppressed'].includes(result.state) ? 'Refund email could not be delivered. The refund remains confirmed.'
  : result.observation === 'delivered' ? 'Refund email delivered.'
  : result.observation === 'delivery_delayed' ? 'Refund email delivery delayed.'
  : result.state === 'accepted' ? 'Refund email accepted for sending. Delivery is not yet confirmed.'
  : result.state === 'unknown' ? 'Refund email delivery is unconfirmed. The refund remains confirmed.'
  : result.state === 'not_requested' ? 'Refund email is awaiting preparation.' : 'Refund email queued for sending.'
 return <p className='ops-note' role='status'>{query.isPending ? 'Checking refund email status…' : label}</p>
}
