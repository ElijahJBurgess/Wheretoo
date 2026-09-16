import { useEventMetrics } from './operations.queries'
import { money } from './operations.format'
export function EventSalesSummary({ ownerId, eventId }: { ownerId: string; eventId: string }) {
  const metrics = useEventMetrics(ownerId, eventId)
  if (metrics.isPending) return <span className='ops-event-sales'>Loading performance…</span>
  if (metrics.isError || !metrics.data) return <span className='ops-event-sales'>Performance unavailable</span>
  return (
    <span className='ops-event-sales'>
      <span>{metrics.data.sold} / {metrics.data.capacity ?? '—'} sold</span>
      <span>{money(metrics.data.grossSalesMinor)}</span>
    </span>
  )
}
