import { useQueryClient } from '@tanstack/react-query'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { EventChangeError, previewEventNotice, submitEventNotice } from './eventChanges.api'
import { useEventNoticeStatus } from './eventChanges.queries'
import { clearNoticeIntent, readNoticeIntent, rememberNoticeIntent } from './noticeIntent'
import type { NoticePreview, NoticePurpose } from './eventChanges.schemas'
export function EventNoticePanel({ eventId, ownerId, purpose, expectedSnapshotId, onSubmitted }: { eventId: string; ownerId: string; purpose: NoticePurpose; expectedSnapshotId?: string; onSubmitted?(): void }) {
 const client = useQueryClient()
 const status = useEventNoticeStatus(eventId, ownerId, purpose)
 const [restored] = useState(() => readNoticeIntent(ownerId, eventId, purpose))
 const [preview, setPreview] = useState<NoticePreview | null>(restored?.preview ?? null)
 const [ambiguous, setAmbiguous] = useState(!!restored)
 const [busy, setBusy] = useState(false)
 const active = useRef(false)
 const [feedback, setFeedback] = useState<string | null>(restored ? 'A previous submission needs confirmation. Retry this exact reviewed submission to reconcile it safely.' : null)
 async function review() {
  if (active.current) return
  const isCurrent = captureIdentityLifetime(client, ownerId)
  active.current = true; setBusy(true)
  try {
   const next = await previewEventNotice(eventId, purpose)
   if (!isCurrent()) return
   if (purpose === 'event_change' && next.snapshotId !== expectedSnapshotId) {
    setPreview(null); setFeedback('Saved event details changed. Refresh history, then review the new audience.'); return
   }
   clearNoticeIntent(ownerId, eventId, purpose)
   setPreview(next); setAmbiguous(false); setFeedback(null)
  } catch { if (!isCurrent()) return; setFeedback('Notice review unavailable. No new submission was made.'); setPreview(null) }
  finally { active.current = false; setBusy(false) }
 }
 async function submit() {
  if (active.current || !preview || (!ambiguous && purpose === 'event_change' && preview.snapshotId !== expectedSnapshotId) || !preview.complete || !preview.canSend || !preview.eligibleMessages) return
  const isCurrent = captureIdentityLifetime(client, ownerId)
  active.current = true; setBusy(true)
  try {
   const intent = rememberNoticeIntent(ownerId, preview)
   const receipt = await submitEventNotice(eventId, purpose, intent.preview.previewToken, intent.requestId)
   if (!isCurrent()) return
   setFeedback(`${receipt.queuedMessages} message${receipt.queuedMessages === 1 ? '' : 's'} queued. This does not confirm sending or delivery.`)
   setPreview(null); setAmbiguous(false)
   try { clearNoticeIntent(ownerId, eventId, purpose) } catch { /* A retained completed identity is safe to replay. */ }
   onSubmitted?.()
   void status.refetch()
  } catch (error) {
   if (!isCurrent()) return
   if (error instanceof EventChangeError && (error.kind === 'conflict' || error.kind === 'no_audience')) {
    setPreview(null); setAmbiguous(false)
    setFeedback(error.kind === 'conflict' ? 'The event or audience changed. Refresh and review the new audience before sending.' : 'There are no pending eligible messages. Review again to check for new purchases or registrations.')
    try { clearNoticeIntent(ownerId, eventId, purpose) } catch { /* Existing identity remains safe to replay. */ }
   } else { setAmbiguous(true); setFeedback('Submission result unknown. Retry this exact reviewed submission using its saved request identity. No delivery is confirmed.') }
  } finally { active.current = false; setBusy(false) }
 }
 const result = status.data
 return <section className="event-change-section" aria-labelledby={`notice-${purpose}`}>
  <p className="organizer-eyebrow">Attendee communication</p><h2 id={`notice-${purpose}`}>{purpose === 'event_change' ? 'Event change notice' : 'Cancellation notice'}</h2>
  <p>Review recipients before explicitly submitting a notice. Saving, publishing and cancelling do not send email. Each paid order or free registration receives one message; multiple orders can share an email address.</p>
  {feedback ? <p role="status">{feedback}</p> : null}
  {preview && purpose === 'event_change' && preview.snapshotId !== expectedSnapshotId ? <p role="alert">{ambiguous ? 'This pending submission belongs to the previously reviewed event version. Retry the same submission to confirm its result; a new notice requires a new review.' : 'Saved event details changed. Refresh history, then review the new audience.'}</p> : null}
  {preview ? <div className="event-notice-review"><h3>Reviewed audience</h3><dl className="event-change-counts">{Object.entries({ 'Eligible messages': preview.eligibleMessages, 'Distinct recipient addresses': preview.distinctRecipients, 'Previously submitted messages': preview.alreadySubmitted, 'Excluded messages': preview.excludedMessages, 'Invalid recipients': preview.invalidRecipients, 'Blocked recipients': preview.blockedRecipients }).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{preview.complete && count !== null ? count : 'Unavailable'}</dd></div>)}</dl>
   {!preview.complete ? <p>Audience incomplete. Sending unavailable.</p> : !preview.canSend ? <p>Sending unavailable until the exact changed revision is public, or cancellation is confirmed.</p> : !preview.eligibleMessages ? <p>No pending eligible messages.</p> : null}
   <Button disabled={busy || (!ambiguous && purpose === 'event_change' && preview.snapshotId !== expectedSnapshotId) || !preview.complete || !preview.canSend || !preview.eligibleMessages} onClick={() => void submit()}>{busy ? 'Working…' : ambiguous ? 'Retry same notice submission' : 'Submit reviewed notice'}</Button>
  </div> : null}
  <Button disabled={busy} onClick={() => void review()} variant="secondary">{preview || feedback ? 'Refresh and review new audience' : 'Review notice recipients'}</Button>
  <h3>Dispatch status</h3>{status.isPending ? <p role="status">Loading notice status…</p> : status.isError || !result ? <p role="alert">Notice status unavailable</p> : <>
   <dl className="event-change-counts">{Object.entries({ 'Total messages': result.total, Queued: result.queued, Sending: result.sending, 'Provider accepted': result.accepted, Failed: result.failed, Unknown: result.unknown, Suppressed: result.suppressed }).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
   <h3>Provider observations</h3><p>Acceptance is not delivery. These observations are reported separately from dispatch.</p><dl className="event-change-counts">{Object.entries(result.observations).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
  </>}
  <Button disabled={status.isFetching || busy} onClick={() => void status.refetch()} variant="secondary">Refresh notice status</Button>
 </section>
}
