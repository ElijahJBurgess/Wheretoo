import { Link, useParams } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { useEventMetrics } from './operations.queries'
import { EventHero, money, OperationsError } from './OperationsUi'
export function OrganizerDashboardPage() {
 const { eventId = '' } = useParams()
 const session = useSession()
 const query = useEventMetrics(session.status === 'authenticated' ? session.user.id : '', eventId)
 if (query.isPending) return <p role="status" className="operations-state">Loading event dashboard…</p>
 if (query.isError) return <OperationsError title="Event metrics unavailable" retry={() => void query.refetch()} />
 const data = query.data
 return <section className="operations-page"><Link className="ops-back" to="/organizer/events">← My Events</Link><EventHero metrics={data} /><div className="ops-actions">{data.admissionEligible ? <Link className="ops-button ops-button--primary" to={`/organizer/events/${eventId}/check-in`}>Check in guests</Link> : <button className="ops-button" disabled>Check-in closed</button>}<Link className="ops-button" to={`/organizer/events/${eventId}`}>View event</Link><Link className="ops-button" to={`/organizer/events/${eventId}/edit`}>Edit event</Link></div><dl className="ops-metrics"><div><dd>{money(data.grossSalesMinor)}</dd><dt>Gross ticket sales</dt></div><div><dd>{data.sold.toLocaleString()} / {data.capacity?.toLocaleString() ?? '—'}</dd><dt>Tickets sold</dt></div><div><dd>{data.orderCount.toLocaleString()}</dd><dt>Orders</dt></div><div><dd>{data.checkedIn.toLocaleString()} / {data.issued.toLocaleString()}</dd><dt>Checked in</dt></div></dl><p className="ops-note">Historical performance includes refunded purchases. Check-in is used tickets / all issued tickets.</p><div className="ops-section-heading"><h2>Ticket breakdown</h2><Link to={`/organizer/events/${eventId}/orders`}>View orders</Link></div><div className="ops-panel">{data.tiers.length ? data.tiers.map(tier => <div className="ops-tier" key={tier.id}><div><h3>{tier.name}{tier.status !== 'active' && <span className="ops-muted"> · {tier.status}</span>}</h3><p>{tier.sold} sold · {tier.remaining} remaining</p></div><strong>{money(tier.grossSalesMinor)}</strong></div>) : <p className="operations-state">No ticket tiers configured.</p>}</div><p className="ops-note">Remaining inventory includes active checkout reservations. Refunded inventory can be sold again.</p></section>
}
