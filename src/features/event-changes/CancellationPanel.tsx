import { useQueryClient } from '@tanstack/react-query'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { useCancelOwnedEvent } from '../events/event.queries'
import { reconcileCancellation } from './cancellationRecovery'
export function CancellationPanel({ eventId, ownerId, onConfirmed, canCancel = true, eligibilityRevision }: { eventId: string; ownerId: string; onConfirmed(): void; canCancel?: boolean; eligibilityRevision?: string }) {
 const client = useQueryClient()
 const mutation = useCancelOwnedEvent(ownerId)
 const [confirm, setConfirm] = useState(false)
 const [state, setState] = useState<'ready' | 'pending' | 'unknown' | 'published'>('ready')
 const [publishedRevision, setPublishedRevision] = useState<string | undefined>()
 const active = useRef(false)
 const trigger = useRef<HTMLButtonElement>(null)
 const confirmButton = useRef<HTMLButtonElement>(null)
 const restoreFocus = useRef(false)
 useEffect(() => { if (confirm) confirmButton.current?.focus(); else if (restoreFocus.current) { trigger.current?.focus(); restoreFocus.current = false } }, [confirm])
 const busy = state === 'pending' || mutation.isPending
 const eligible = canCancel || (state === 'published' && publishedRevision === eligibilityRevision)
 async function reconcile(isCurrent: () => boolean) {
  const outcome = await reconcileCancellation(eventId, ownerId)
  if (!isCurrent()) return
  if (outcome === 'cancelled') onConfirmed()
  else {
   if (outcome === 'published') setPublishedRevision(eligibilityRevision)
   setState(outcome)
  }
 }
 async function cancel() {
  if (active.current || busy || state === 'unknown' || !eligible) return
  const isCurrent = captureIdentityLifetime(client, ownerId)
  active.current = true; setState('pending')
  try {
   const event = await mutation.mutateAsync(eventId)
   if (!isCurrent()) return
   if (event.id !== eventId || event.organizer_id !== ownerId || event.status !== 'cancelled') throw new Error('Cancellation reply unavailable')
   onConfirmed()
  } catch { await reconcile(isCurrent) }
  finally { active.current = false }
 }
 async function check() {
  if (active.current || busy) return
  const isCurrent = captureIdentityLifetime(client, ownerId)
  active.current = true; setState('pending')
  try { await reconcile(isCurrent) } finally { active.current = false }
 }
 function close() { if (busy) return; restoreFocus.current = true; setConfirm(false) }
 return <section className="review-request">
  {!confirm ? <Button ref={trigger} disabled={!eligible && state === 'ready'} variant="secondary" onClick={() => setConfirm(true)}>{state === 'unknown' ? 'Review cancellation status' : 'Cancel event'}</Button> : <div aria-labelledby="cancel-event-title" onKeyDown={e => { if (e.key === 'Escape') close() }}>
   <h2 id="cancel-event-title">Cancel this event?</h2>
   <p>This removes the event from discovery and stops unused admissions. Used admissions keep their check-in history. Cancellation does not automatically refund payments or send email.</p>
   {state === 'unknown' ? <p role="alert">Cancellation status unknown. The server could not confirm this event’s current state. Cancellation retry is disabled until status is verified.</p> : state === 'published' ? <p role="status">{eligible ? 'The server confirmed this event is still published. You can deliberately try cancellation again.' : 'The previous read confirmed this event was published. Check current event status before trying cancellation again.'}</p> : null}
   <div className="published-event__actions"><Button ref={confirmButton} disabled={busy || state === 'unknown' || !eligible} onClick={() => void cancel()}>{busy ? 'Checking cancellation…' : state === 'published' ? 'Try cancellation again' : 'Confirm cancellation'}</Button>
   {state === 'unknown' ? <Button disabled={busy} onClick={() => void check()} variant="secondary">Check cancellation status</Button> : null}
   <Button disabled={busy} onClick={close} variant="secondary">{state === 'unknown' ? 'Close confirmation' : 'Keep event'}</Button></div>
  </div>}
 </section>
}
