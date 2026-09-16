import { useEffect, useRef } from 'react'
import { OperationsDialog } from '../organizer-operations/OperationsDialog'
import { dateTime, money } from '../organizer-operations/operations.format'
import { RefundStateNotice, type RefundViewState } from './RefundStateNotice'
import type { RefundStatus } from './refunds.schemas'
export function RefundOrderDialog({ order, state, busy, canSubmit, onSubmit, onClose }: {
 order: RefundStatus; state: RefundViewState; busy: boolean; canSubmit: boolean; onSubmit(): void; onClose(): void
}) {
 const warning = useRef<HTMLParagraphElement>(null)
 useEffect(() => {
  // Native modal autofocus otherwise scrolls long summaries down to Cancel.
  // Run after OperationsDialog opens, preserving its captured return-focus target.
  warning.current?.focus({ preventScroll: true })
  const dialog = warning.current?.closest('dialog')
  if (dialog) dialog.scrollTop = 0
 }, [])
 return <OperationsDialog title='Refund this order?' busy={busy} onClose={onClose} className='refund-dialog'>
  <div className='refund-danger-symbol' aria-hidden='true'>!</div>
  <p ref={warning} tabIndex={-1} className='refund-dialog__warning'>This refunds the full order. Unused tickets become refunded after payment confirmation. Previous check-ins stay in the event history.</p>
  <section className='refund-dialog__summary' aria-label='Refund summary'>
   <h3>Order #{order.orderNumber}</h3><p>{order.eventName}</p><p><strong>{order.buyerName}</strong><br />{order.buyerEmail}</p>
   {order.items.map((item, index) => <p key={index}>{item.quantity} × {item.tierName}<strong>{money(item.subtotalMinor)}</strong></p>)}
   <p>{order.quantity} tickets · Whole order refund<strong>{money(order.totalMinor)}</strong></p>
   <ul>{order.tickets.map((ticket, index) => <li key={ticket.id}>Ticket {index + 1} · {ticket.admissionLabel} · {ticket.status === 'used' ? 'Used' : ticket.status === 'valid' ? 'Valid' : ticket.status === 'refunded' ? 'Refunded' : 'Cancelled'}{ticket.usedAt && <small>Checked in · {dateTime(ticket.usedAt)}</small>}</li>)}</ul>
  </section>
  <p className='ops-note'>A refund notice is prepared for this buyer after confirmation. Email delivery is tracked separately.</p>
  <RefundStateNotice state={state} />
  {!canSubmit && state === 'eligible' && <p role='status'>A refund cannot be requested until the current order status is confirmed.</p>}
  <div className='ops-actions'>
   <button className='ops-button' disabled={busy} onClick={onClose}>{state === 'eligible' ? 'Cancel' : 'Done'}</button>
   {(state === 'eligible' || state === 'submitting') && <button className='ops-button ops-button--danger' disabled={busy || !canSubmit} onClick={onSubmit}>{busy ? 'Submitting refund…' : 'Confirm refund'}</button>}
  </div>
 </OperationsDialog>
}
