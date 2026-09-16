import { ReadState } from '../../components/ui/ReadState'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BuyerEventSummary } from '../buyer-journey/BuyerPrimitives'
import { useTicketDocumentPrivacy } from '../ticket-experience/customer/useTicketDocumentPrivacy'
import { DeliverySupport } from '../ticket-delivery/DeliverySupport'
import { dateTime, money } from '../organizer-operations/operations.format'
import { getRefundDetails, RefundDetailError } from './refunds.public-api'
import { clearRefundGrant, readRefundGrant, shortenRefundGrant } from './refunds.session'
import { RefundedTicketContext } from './RefundedTicketContext'
import type { RefundDetail } from './refunds.schemas'
import './refunds.css'
function Frame({ children }: { children: ReactNode }) {
 return <main className='buyer-page refund-details'><header className='refund-details__header'><span className='buyer-wordmark'>wheretoo</span><Link to='/'>Back to Wheretoo</Link></header><div className='refund-details__content'>{children}</div></main>
}
function Unavailable() {
 return <Frame><ReadState headingAs='h1' status='unavailable' title='Refund link unavailable' description='This private refund link has expired or is no longer available.' /><DeliverySupport /></Frame>
}
export function RefundDetailsPage() {
 const location = useLocation()
 return <ScopedRefundDetailsPage key={location.key} />
}
function ScopedRefundDetailsPage() {
 useTicketDocumentPrivacy()
 const [grant] = useState(readRefundGrant)
 const [version, setVersion] = useState(0)
 const [loaded, setLoaded] = useState<{ version: number; value?: RefundDetail; error?: 'unavailable' | 'temporary' | 'rate_limited' } | null>(null)
 const [expired, setExpired] = useState(false)
 const resolved = loaded?.version === version ? loaded : null
 const value = resolved?.value
 const expiresAt = Math.min(grant?.expiresAt ?? 0, value ? Date.parse(value.expiresAt) : Infinity)
 useEffect(() => {
  if (!grant || expired) return
  const controller = new AbortController()
  getRefundDetails(grant.token, controller.signal).then(result => {
   if (controller.signal.aborted) return
   shortenRefundGrant(grant, result.expiresAt)
   setLoaded({ version, value: result })
  }, error => {
   if (controller.signal.aborted) return
   const kind = error instanceof RefundDetailError ? error.kind : 'temporary'
   if (kind === 'unavailable') clearRefundGrant()
   setLoaded({ version, error: kind })
  })
  return () => controller.abort()
 }, [grant, expired, version])
 useEffect(() => {
  if (!grant || expired) return
  let timer: number
  const check = () => {
   if (Date.now() >= expiresAt) { clearRefundGrant(); setLoaded(null); setExpired(true); return }
   // Browsers clamp delays above 2^31; long grants are checked in bounded intervals.
   timer = window.setTimeout(check, Math.min(expiresAt - Date.now(), 60 * 60 * 1000))
  }
  check()
  return () => window.clearTimeout(timer)
 }, [grant, expired, expiresAt])
 if (!grant || expired || resolved?.error === 'unavailable') return <Unavailable />
 if (resolved?.error) return <Frame><ReadState headingAs='h1' status='unavailable' title={resolved.error === 'rate_limited' ? 'Please wait a moment' : 'Refund details temporarily unavailable'} description='Try this same refund link again in a moment. Your order’s refund status has not changed.' action={<button className='ui-button buyer-primary' onClick={() => setVersion(v => v + 1)}>Try this refund link again</button>} /><DeliverySupport /></Frame>
 if (!value) return <Frame><ReadState headingAs='h1' status='loading' skeleton='detail-fields' title='Loading your refund details…' /></Frame>
 const order = value.order
 return <Frame><p className='refund-details__eyebrow'>Order #{order.orderNumber}</p><h1>Your order has been refunded</h1><p>The full refund is confirmed. This page is your order history and cannot be used for entry.</p>
  <BuyerEventSummary title={order.eventName} schedule={`${dateTime(order.startsAt, order.timezone)} – ${dateTime(order.endsAt, order.timezone)}`} venue={order.venueName} />
  <section className='refund-details__summary' aria-label='Refund details'><dl><div><dt>Total paid</dt><dd>{money(order.totalMinor)}</dd></div><div><dt>Refund amount</dt><dd><strong>{money(order.refundAmountMinor)}</strong></dd></div><div><dt>Refund confirmed</dt><dd>{dateTime(order.completedAt, order.timezone)}</dd></div></dl></section>
  <h2>Purchased</h2><section className='refund-details__summary' aria-label='Purchased items'>{order.items.map((item, index) => <div className='refund-details__item' key={index}><span>{item.quantity} × {item.tierName}</span><strong>{money(item.subtotalMinor)}</strong></div>)}<dl><div><dt>Subtotal</dt><dd>{money(order.subtotalMinor)}</dd></div><div><dt>Tax</dt><dd>{money(order.totalMinor - order.subtotalMinor)}</dd></div></dl></section>
  <h2>Your tickets</h2><ul className='refund-details__tickets'>{order.tickets.map((ticket, index) => <li key={ticket.id}><RefundedTicketContext orderNumber={order.orderNumber} admissionLabel={ticket.admissionLabel} position={index + 1} status={ticket.status} usedAt={ticket.usedAt} timezone={order.timezone} /></li>)}</ul>
  <DeliverySupport />
 </Frame>
}
