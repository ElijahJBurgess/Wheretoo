import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ResendTicketsDialog } from '../ticket-delivery/ResendTicketsDialog'
import { operationsKeys } from '../organizer-operations/operations.queries'
import { isRefundAccessDenied, requestRefund } from './refunds.api'
import { refundKeys, useRefundStatus } from './refunds.queries'
import { RefundOrderDialog } from './RefundOrderDialog'
import { RefundNoticeStatus } from './RefundNoticeStatus'
import { RefundStateNotice, type RefundViewState } from './RefundStateNotice'
import './refunds.css'
export function RefundOrderPanel(props: { ownerId: string; eventId: string; orderId: string; orderReadUnavailable?: boolean }) {
 return <ScopedRefundOrderPanel key={`${props.ownerId}:${props.eventId}:${props.orderId}`} {...props} />
}
function ScopedRefundOrderPanel({ ownerId, eventId, orderId, orderReadUnavailable = false }: { ownerId: string; eventId: string; orderId: string; orderReadUnavailable?: boolean }) {
 const client = useQueryClient()
 const [open, setOpen] = useState(false)
 const [resendOpen, setResendOpen] = useState(false)
 const inFlight = useRef(false)
 const mutation = useMutation({ mutationKey: [...refundKeys.status(ownerId, eventId, orderId), 'request'], gcTime: 0, retry: false,
  mutationFn: (action: 'submit' | 'reconcile') => requestRefund(eventId, orderId, action),
  onSettled: async (_data, error) => {
   if (!isRefundAccessDenied(error)) await client.invalidateQueries({ queryKey: operationsKeys.event(ownerId, eventId) })
   inFlight.current = false
  },
 })
 const deniedMutation = isRefundAccessDenied(mutation.error)
 const query = useRefundStatus(ownerId, eventId, orderId, deniedMutation)
 const { refetch } = query
 const denied = !ownerId || deniedMutation || isRefundAccessDenied(query.error)
 const canonical = query.isFetchedAfterMount && !query.isError ? query.data : undefined
 const canonicalState = canonical?.state
 const attempted = mutation.isSuccess || mutation.isError
 // Even a completed acknowledgment cannot establish completion without a canonical read.
 let state: RefundViewState = denied ? 'unauthorized' : mutation.isPending ? 'submitting' : canonical?.state ?? 'unknown'
 if (attempted && state === 'eligible') state = 'unknown'
 if (canonical?.state === 'completed' && mutation.data?.outcome === 'already_refunded') state = 'already_refunded'
 const canSubmit = !orderReadUnavailable && !!canonical && state === 'eligible' && canonical.action === 'submit' && !query.isFetching && !attempted
 const canResend = !orderReadUnavailable && !!canonical && !query.isFetching && !mutation.isPending && state === 'eligible'
 const submit = (action: 'submit' | 'reconcile') => {
  if (inFlight.current || denied || mutation.isPending || query.isError) return
  if (action === 'submit' ? !canSubmit : canonical?.action !== 'reconcile') return
  inFlight.current = true
  mutation.mutate(action)
 }
 // An uncertain response with no persisted operation yet must still be re-read; never re-submit.
 useEffect(() => {
  if (denied || !attempted || (canonicalState && canonicalState !== 'eligible')) return
  const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refetch() }, 5000)
  return () => window.clearInterval(timer)
 }, [denied, attempted, canonicalState, refetch])
 if (denied) return <RefundStateNotice state='unauthorized' />
 if (query.isPending || !query.isFetchedAfterMount) return <section className='refund-panel' aria-label='Refund actions'><p role='status'>Checking refund status…</p><button className='ops-button' disabled>Resend tickets</button></section>
 return <section className='refund-panel' aria-label='Refund actions'>
  <RefundStateNotice state={state} />
  {query.isError && <p role='alert'>Current refund status could not be loaded. Completion is unconfirmed.</p>}
  <div className='ops-actions'>
   <button className='ops-button' disabled={!canResend} aria-describedby={!canResend ? 'refund-resend-explanation' : undefined} onClick={() => setResendOpen(true)}>Resend tickets</button>
   {state === 'eligible' && <button className='ops-button ops-button--danger' disabled={!canSubmit} onClick={() => setOpen(true)}>Refund order</button>}
   {canonical?.action === 'reconcile' && !mutation.isPending && <button className='ops-button' disabled={query.isFetching} onClick={() => submit('reconcile')}>Check existing refund</button>}
   {['unknown', 'submitting', 'processing', 'review'].includes(state) && !mutation.isPending && <button className='ops-button' disabled={query.isFetching} onClick={() => void refetch()}>Refresh refund status</button>}
  </div>
  {!canResend && <p id='refund-resend-explanation' className='ops-note'>Tickets cannot be resent while this order is refunded, unavailable, or awaiting refund verification.{state === 'failed' && ' Failed refunds need support before tickets can be resent.'}</p>}
  {resendOpen && canResend && <ResendTicketsDialog ownerId={ownerId} eventId={eventId} sourceKind='paid_order' sourceId={orderId} onClose={() => setResendOpen(false)} />}
  {open && query.data && <RefundOrderDialog order={query.data} state={state} busy={mutation.isPending} canSubmit={canSubmit} onSubmit={() => submit('submit')} onClose={() => setOpen(false)} />}
  {(state === 'completed' || state === 'already_refunded') && <RefundNoticeStatus ownerId={ownerId} eventId={eventId} orderId={orderId} />}
  <p className='ops-note'>Refunds apply to the entire order. Used admissions retain their check-in history.</p>
 </section>
}
