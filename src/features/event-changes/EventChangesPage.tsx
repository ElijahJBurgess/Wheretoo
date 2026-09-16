import { Link, useParams } from 'react-router-dom'
import { ReadState } from '../../components/ui/ReadState'
import { Button } from '../../components/ui/Button'
import { useSession } from '../auth/SessionProvider'
import { dateTime } from '../organizer-operations/operations.format'
import { useEventChangeContext } from './eventChanges.queries'
import { EventNoticePanel } from './EventNoticePanel'
import type { EventSnapshot } from './eventChanges.schemas'
import type { EventFacts } from './eventStatus.schemas'
import './event-changes.css'
const fields: { key: keyof EventFacts; label: string }[] = [
 { key: 'starts_at', label: 'Starts' }, { key: 'ends_at', label: 'Ends' }, { key: 'timezone', label: 'Time zone' },
 { key: 'venue_name', label: 'Venue' }, { key: 'address_line1', label: 'Address' }, { key: 'address_line2', label: 'Address details' },
 { key: 'city', label: 'City' }, { key: 'region', label: 'Region' }, { key: 'postal_code', label: 'Postal code' }, { key: 'country_code', label: 'Country' },
 { key: 'latitude', label: 'Map latitude' }, { key: 'longitude', label: 'Map longitude' },
 { key: 'admission_type', label: 'Admission type' }, { key: 'disclosures', label: 'Entry requirements' },
 { key: 'title', label: 'Event name' }, { key: 'description', label: 'Description' }, { key: 'category', label: 'Category' },
]
function formatEventFact(facts: EventFacts | null, key: keyof EventFacts): string {
 if (!facts) return 'Unavailable — no recorded snapshot'
 const value = facts[key]
 if (value === null) return 'Not specified'
 if (key === 'starts_at' || key === 'ends_at') return dateTime(String(value), facts.timezone)
 if (key === 'disclosures' && facts.disclosures) {
  const d = facts.disclosures
  return [d.minimum_age === 'all_ages' ? 'All ages' : d.minimum_age === '18_plus' ? 'Ages 18+' : 'Ages 21+',
   ...([['alcohol_present', 'Alcohol'], ['cannabis_present', 'Cannabis'], ['explicit_adult_content', 'Adult content'], ['gambling_present', 'Gambling'], ['weapons_present', 'Weapons'], ['high_risk_activity', 'High-risk activity']] as const).map(([field, label]) => `${label}: ${d[field] ? 'Disclosed' : 'Not disclosed'}`),
  ].join('; ')
 }
 return String(value)
}
function Comparison({ title, previousLabel, currentLabel, previous, current }: { title: string; previousLabel: string; currentLabel: string; previous: EventSnapshot | null; current: EventSnapshot | null }) {
 const changed = fields.filter(({ key }) => previous && current && JSON.stringify(previous.facts[key]) !== JSON.stringify(current.facts[key]))
 const prominent = changed.filter(({ key }) => key !== 'latitude' && key !== 'longitude')
 const mapChanged = previous && current && ['latitude', 'longitude', 'mapbox_feature_id'].some(key => previous.facts[key as keyof EventFacts] !== current.facts[key as keyof EventFacts])
 const rows = (items: typeof fields) => <div className="event-change-table-wrap"><table className="event-change-table"><thead><tr><th scope="col">Detail</th><th scope="col">{previousLabel}</th><th scope="col">{currentLabel}</th></tr></thead><tbody>{items.map(({ key, label }) => <tr key={key} className={changed.some(row => row.key === key) ? 'event-change-table__changed' : undefined}><th scope="row">{label}</th><td data-label={previousLabel}>{formatEventFact(previous?.facts ?? null, key)}</td><td data-label={currentLabel}>{formatEventFact(current?.facts ?? null, key)}</td></tr>)}</tbody></table></div>
 return <section className="event-change-section"><h2>{title}</h2>
  {previous ? <p>{previousLabel}: {dateTime(previous.captured_at)}. {currentLabel}: {current ? dateTime(current.captured_at) : 'Unavailable'}.</p> : <p>{previousLabel} unavailable. Earlier details were not recorded; no previous dates or location are assumed.</p>}
  {!current ? <p>{currentLabel} unavailable. No recorded snapshot.</p> : !previous ? <details className="event-history-details"><summary>View {currentLabel.toLowerCase()} details</summary><p>Recorded {dateTime(current.captured_at)}.</p><dl className="event-history-facts">{fields.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{formatEventFact(current.facts, key)}</dd></div>)}</dl></details> : <>
   {prominent.length ? rows(prominent) : <p>No changed event details in this comparison.</p>}
   {mapChanged ? <p>The verified map location changed. Review the saved location in the event editor; recorded map coordinates are available below.</p> : null}
   <details className="event-history-details"><summary>View all recorded details</summary>{rows(fields)}</details>
  </>}
 </section>
}
export function EventChangesPage() {
 const { eventId = '' } = useParams()
 const session = useSession()
 const ownerId = session.status === 'authenticated' ? session.user.id : ''
 const query = useEventChangeContext(eventId, ownerId)
 if (query.isError) return <ReadState headingAs="h1" status="unavailable" title="Saved change history unavailable" action={<Button onClick={() => void query.refetch()}>Reload history</Button>} />
 if (!query.data) return <ReadState headingAs="h1" paused={query.fetchStatus === 'paused'} status="loading" skeleton="detail-fields" title="Loading saved changes" />
 const context = query.data
 return <section className="event-changes"><header><p className="organizer-eyebrow">Same event · saved history</p><h1>Previous → New</h1><p>{context.event.title ?? 'Untitled event'}</p><p role="status">{context.event.status === 'cancelled' ? 'Cancelled' : context.currently_publicly_eligible ? 'Live' : context.event.moderation_status === 'under_review' ? 'Under review' : 'Saved · not currently public'}</p></header>
  <p className="event-change-notice" role="status">{context.notice_required ? 'Notice required' : 'No outstanding required notice'}{context.notice_required ? '. Review the actual public revision and recipients before submitting.' : '. You can review for newly eligible purchases or registrations.'}</p>
  <Comparison title="Saved changes" previousLabel="Previous saved" currentLabel="Current saved" previous={context.previous_saved} current={context.current_saved} />
  <Comparison title="Actual public history" previousLabel="Previous public" currentLabel="Latest actual public" previous={context.previous_publicly_eligible} current={context.current_publicly_eligible} />
  {!context.currently_publicly_eligible ? <p>The latest actual public snapshot is historical. The current saved event is not currently publicly eligible.</p> : null}
  <EventNoticePanel key={`${eventId}:${context.event.status}`} eventId={eventId} ownerId={ownerId} expectedSnapshotId={context.current_saved.snapshot_id} onSubmitted={() => { void query.refetch() }} purpose={context.event.status === 'cancelled' ? 'event_cancellation' : 'event_change'} />
  <nav className="published-event__actions" aria-label="Event change actions">{context.event.status !== 'cancelled' ? <><Link to={`/organizer/events/${eventId}/edit`}>Edit event</Link><Link to={`/organizer/events/${eventId}/preview`}>Preview saved event</Link></> : null}<Link to={`/organizer/events/${eventId}/cancellation`}>Cancellation status</Link><Link to={`/organizer/events/${eventId}`}>Back to event</Link><Button disabled={query.isFetching} onClick={() => void query.refetch()} variant="secondary">Refresh history</Button></nav>
 </section>
}
