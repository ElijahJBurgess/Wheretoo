import { ReadState } from '../../components/ui/ReadState'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTicketDocumentPrivacy } from '../ticket-experience/customer/useTicketDocumentPrivacy'
import { DeliverySupport } from '../ticket-delivery/DeliverySupport'
import { dateTime, money } from '../organizer-operations/operations.format'
import { clearEventStatusGrant, readEventStatusGrant, shortenEventStatusGrant } from './eventStatus.session'
import { EventStatusError, getEventStatus } from './eventStatus.public-api'
import type { EventStatusAccess } from './eventStatus.schemas'
import './event-changes.css'
function Frame({ children }: { children: ReactNode }) { return <main className="buyer-page private-event-status"><header><span className="buyer-wordmark">wheretoo</span><Link to="/discover">Browse events</Link></header><div className="private-event-status__content">{children}</div></main> }
const finance: Record<EventStatusAccess['detail']['financialState'], string> = {
 not_applicable: 'This is a free registration. No payment or refund applies.', completed: 'Your whole-order refund is confirmed.',
 processing: 'Your refund is processing. Completion is not yet confirmed.', submitting: 'Your refund is processing. Completion is not yet confirmed.',
 unknown: 'Your refund status is unknown. Refresh this private status page for updates.', failed: 'Your refund needs attention. Completion is not confirmed.',
 review: 'Your payment or refund is under review. No refund completion is confirmed.', ineligible: 'Your payment or refund is under review. No refund completion is confirmed.',
 eligible: 'No refund is recorded. Refresh this private status page for updates.',
}
export function EventStatusPage() { const location = useLocation(); return <ScopedEventStatusPage key={location.key} /> }
function ScopedEventStatusPage() {
 useTicketDocumentPrivacy()
 const [grant] = useState(readEventStatusGrant)
 const [version, setVersion] = useState(0)
 const [expired, setExpired] = useState(false)
 const [loaded, setLoaded] = useState<{ version: number; value?: EventStatusAccess; error?: 'unavailable' | 'temporary' | 'rate_limited' } | null>(null)
 const resolved = loaded?.version === version ? loaded : null
 const value = resolved?.value
 const expiresAt = Math.min(grant?.expiresAt ?? 0, value ? Date.parse(value.expiresAt) : Infinity)
 useEffect(() => {
  if (!grant || expired) return
  const controller = new AbortController()
  getEventStatus(grant.token, controller.signal).then(result => {
   if (controller.signal.aborted) return
   shortenEventStatusGrant(grant, result.expiresAt); setLoaded({ version, value: result })
  }, error => {
   if (controller.signal.aborted) return
   const kind = error instanceof EventStatusError ? error.kind : 'temporary'
   if (kind === 'unavailable') clearEventStatusGrant()
   setLoaded({ version, error: kind })
  })
  return () => controller.abort()
 }, [grant, expired, version])
 useEffect(() => {
  if (!grant || expired) return
  let timer: number
  const check = () => {
   if (Date.now() >= expiresAt) { clearEventStatusGrant(); setLoaded(null); setExpired(true); return }
   timer = window.setTimeout(check, Math.min(expiresAt - Date.now(), 60 * 60 * 1000))
  }
  check(); return () => window.clearTimeout(timer)
 }, [grant, expired, expiresAt])
 if (!grant || expired || resolved?.error === 'unavailable') return <Frame><ReadState headingAs="h1" status="unavailable" title="Event status link unavailable" description="This private link has expired or is no longer available." /><DeliverySupport /></Frame>
 if (resolved?.error) return <Frame><ReadState headingAs="h1" status="unavailable" title={resolved.error === 'rate_limited' ? 'Please wait a moment' : 'Event status temporarily unavailable'} description="Try this same private link again in a moment. No new event, payment or admission status is confirmed." action={<button className="ui-button buyer-primary" onClick={() => setVersion(v => v + 1)}>Try this status link again</button>} /><DeliverySupport /></Frame>
 if (!value) return <Frame><ReadState headingAs="h1" status="loading" skeleton="detail-fields" title="Loading your event status…" /></Frame>
 const detail = value.detail
 const facts = detail.facts
 const zone = facts?.timezone ?? 'UTC'
 return <Frame><p className="organizer-eyebrow">Private event status{detail.orderNumber ? ` · Order #${detail.orderNumber}` : ' · Registration'}</p><h1>{detail.eventStatus === 'cancelled' ? 'Event cancelled' : value.purpose === 'event_change' ? 'Event details updated' : 'Event status'}</h1>
  <p>{detail.eventStatus === 'cancelled' ? 'This event is cancelled. Cancellation and refunds are separate; check the payment status below.' : 'These are the recorded event details for your notice. Refresh to check your current payment and admission status.'}</p>
  {facts ? <section className="event-change-section"><h2>{facts.title ?? 'Event details'}</h2><dl><div><dt>Starts</dt><dd>{facts.starts_at ? dateTime(facts.starts_at, zone) : 'Unavailable'}</dd></div><div><dt>Ends</dt><dd>{facts.ends_at ? dateTime(facts.ends_at, zone) : 'Unavailable'}</dd></div><div><dt>Time zone</dt><dd>{zone}</dd></div><div><dt>Venue</dt><dd>{facts.venue_name ?? 'Not specified'}</dd></div><div><dt>Address</dt><dd>{[facts.address_line1, facts.address_line2, facts.city, facts.region, facts.postal_code].filter(Boolean).join(', ') || 'Not specified'}</dd></div><div><dt>Minimum age</dt><dd>{facts.disclosures ? facts.disclosures.minimum_age === 'all_ages' ? 'All ages' : facts.disclosures.minimum_age === '18_plus' ? 'Ages 18+' : 'Ages 21+' : 'Unavailable'}</dd></div></dl>{facts.disclosures ? <ul>{([['alcohol_present', 'Alcohol'], ['cannabis_present', 'Cannabis'], ['explicit_adult_content', 'Adult content'], ['gambling_present', 'Gambling'], ['weapons_present', 'Weapons'], ['high_risk_activity', 'High-risk activity']] as const).filter(([field]) => facts.disclosures?.[field]).map(([field, label]) => <li key={field}>{label} disclosed</li>)}</ul> : null}</section> : <p>Recorded event details unavailable. No previous schedule is assumed.</p>}
  <section className="event-change-section"><h2>{detail.sourceKind === 'free_registration' ? 'Free registration' : 'Payment and refund'}</h2><p role="status">{finance[detail.financialState]}</p>{detail.totalMinor !== null ? <p>Total paid: {money(detail.totalMinor)}</p> : null}</section>
  <section className="event-change-section"><h2>Admission status</h2><p>{detail.quantity} admission{detail.quantity === 1 ? '' : 's'} originally {detail.sourceKind === 'paid_order' ? 'purchased' : 'registered'}. This status page cannot be used for entry.</p>{detail.tickets.length === 0 ? <p>Payment needs review. No tickets were issued and admission is unavailable.</p> : <ul className="private-event-status__tickets">{detail.tickets.map(ticket => <li key={ticket.id}><strong>{ticket.admissionLabel}</strong><span>{ticket.status === 'used' ? `Used · ${dateTime(ticket.usedAt!, zone)}${facts ? '' : ' UTC'}` : ticket.status === 'cancelled' ? 'Cancelled · Not valid for entry' : ticket.status === 'refunded' ? 'Refunded · Not valid for entry' : 'Valid · Open tickets for entry'}</span></li>)}</ul>}
   {detail.canViewTickets ? <a className="ui-button buyer-primary" href={`/ticket-access#${grant.token}`}>View your tickets</a> : null}
  </section><button className="ui-button buyer-secondary" onClick={() => setVersion(v => v + 1)}>Refresh event status</button><DeliverySupport />
 </Frame>
}
