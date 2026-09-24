import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { useSession } from '../auth/SessionProvider'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { EmailPreview } from './EmailPreview'
import {
  type Intent,
  messageApi,
  MessageError,
  type MessageOptions,
  type MessagePreview,
  type MessageReceipt,
  type Selector,
} from './messages.api'
import './messages.css'
const reasons: Record<string, string> = {
  UNAUTHORIZED: 'Your organizer access could not be verified. Sign in again.',
  EVENT_UNAVAILABLE: 'This event is unavailable.',
  EVENT_CANCELLED: 'Cancelled events cannot send new messages.',
  EVENT_DRAFT: 'Publish this event before messaging attendees.',
  MODERATION_BLOCKED: 'Messaging is blocked while this event is under review.',
  INVALID_SCHEDULE:
    'This event needs a valid schedule before messaging attendees.',
  SEND_WINDOW_CLOSED:
    'The send window has closed. Messages are available until seven days after the event ends.',
  INVALID_SELECTOR:
    'This audience is unavailable. Return to the event and choose again.',
  INVALID_TIER: 'This ticket tier is unavailable. Choose another audience.',
  INACTIVE_INDIVIDUAL:
    'This customer or registration is no longer eligible for messaging.',
  AUDIENCE_UNAVAILABLE:
    'The audience cannot be verified. Try previewing again later.',
  NO_RECIPIENTS:
    'No eligible recipients. Inactive attendees and suppressed email addresses are excluded.',
  PREVIEW_CHANGED:
    'The audience or message details changed. Preview again before sending.',
  AUDIENCE_CHANGED: 'The audience changed. Preview again before sending.',
  LIMIT_REACHED:
    'The messaging limit has been reached. No message was queued. Try again later.',
  PREVIEW_LIMIT_REACHED:
    'Too many previews. Wait a minute before trying again.',
  EMAIL_UNAVAILABLE:
    'Email sending is temporarily unavailable. Try again later.',
  INVALID_SUBJECT: 'Enter a subject of 1–120 characters without line breaks.',
  INVALID_BODY: 'Enter a plain text message of 1–5,000 characters.',
  REQUEST_CONFLICT:
    'This request needs reconciliation. Check its send status before continuing.',
  STORAGE_UNAVAILABLE:
    'Browser storage is unavailable. Sending is blocked so an interrupted request cannot create duplicate messages.',
  UNAVAILABLE: 'Messaging is temporarily unavailable. Try again later.',
  SUBMISSION_UNKNOWN:
    'The result could not be confirmed. Check the original send status.',
}
const describe = (error: unknown) =>
  reasons[error instanceof MessageError ? error.code : 'UNAVAILABLE'] ??
    'Messaging is unavailable. Try again later.'
export function OrganizerMessagePage() {
  const session = useSession(),
    { eventId = '' } = useParams(),
    [search] = useSearchParams()
  if (session.status !== 'authenticated') {
    return <p role='status'>Sign in to message attendees.</p>
  }
  return (
    <Composer
      key={`${session.user.id}:${
        session.identityVersion ?? 0
      }:${eventId}:${search.toString()}`}
      ownerId={session.user.id}
      eventId={eventId}
      order={search.get('order')}
      registration={search.get('registration')}
    />
  )
}
function Composer(
  { ownerId, eventId, order, registration }: {
    ownerId: string
    eventId: string
    order: string | null
    registration: string | null
  },
) {
  const client = useQueryClient(),
    mounted = useRef(false),
    busyRef = useRef(false),
    statusRef = useRef<HTMLHeadingElement>(null)
  const storageKey = `organizer-message:v1:${ownerId}:${eventId}`
  const [recovery] = useState(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (!raw) return { id: null, blocked: false }
      const p = z.object({
        ownerId: z.string(),
        eventId: z.uuid(),
        requestId: z.uuid(),
      }).parse(JSON.parse(raw))
      return {
        id: p.ownerId === ownerId && p.eventId === eventId ? p.requestId : null,
        blocked: p.ownerId !== ownerId || p.eventId !== eventId,
      }
    } catch {
      return { id: null, blocked: true }
    }
  })
  const [pendingId, setPendingId] = useState<string | null>(recovery.id),
    intentRef = useRef<Intent | null>(null),
    hadUnknownOutcome = useRef(recovery.id !== null),
    [hasIntent, setHasIntent] = useState(false)
  const [options, setOptions] = useState<MessageOptions | null>(null),
    [error, setError] = useState(
      recovery.blocked ? reasons.STORAGE_UNAVAILABLE : '',
    ),
    [busy, setBusy] = useState(false)
  const [subject, setSubject] = useState(''),
    [body, setBody] = useState(''),
    [tier, setTier] = useState(''),
    [preview, setPreview] = useState<(MessagePreview & { selector: Selector }) | null>(null),
    [receipt, setReceipt] = useState<MessageReceipt | null>(null)
  const validIndividual = !(order && registration) &&
    (!order || z.uuid().safeParse(order).success) &&
    (!registration || z.uuid().safeParse(registration).success)
  const selector: Selector = order
    ? { kind: 'order', id: order }
    : registration
    ? { kind: 'registration', id: registration }
    : tier
    ? { kind: 'tier', id: tier }
    : { kind: 'everyone' }
  useEffect(() => {
    mounted.current = true
    const current = captureIdentityLifetime(client, ownerId)
    if (!z.uuid().safeParse(eventId).success || !validIndividual) {
      return () => {
        mounted.current = false
      }
    }
    void messageApi.options(ownerId, eventId).then((v) => {
      if (mounted.current && current()) setOptions(v)
    }, (e) => {
      if (mounted.current && current()) setError(describe(e))
    })
    return () => {
      mounted.current = false
      intentRef.current = null
    }
  }, [client, ownerId, eventId, validIndividual])
  useEffect(() => {
    if (preview || pendingId || receipt || error) statusRef.current?.focus()
  }, [preview, pendingId, receipt, error])
  async function run(work: (current: () => boolean) => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const identity = captureIdentityLifetime(client, ownerId)
    const current = () => mounted.current && identity()
    try {
      await work(current)
    } finally {
      if (current()) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }
  function complete(value: MessageReceipt) {
    setReceipt(value)
    setPendingId(null)
    intentRef.current = null
    setHasIntent(false)
    setPreview(null)
    setSubject('')
    setBody('')
    try {
      sessionStorage.removeItem(storageKey)
    } catch {
      /* Keeping metadata is safe: a reload reconciles the existing receipt. */
    }
  }
  async function submit(intent: Intent, current: () => boolean) {
    try {
      const value = await messageApi.submit(ownerId, intent)
      if (current()) complete(value)
    } catch (e) {
      if (!current()) return
      if (
        !hadUnknownOutcome.current &&
        e instanceof MessageError && e.outcome === 'not_queued' &&
        e.code !== 'REQUEST_CONFLICT'
      ) {
        try {
          sessionStorage.removeItem(storageKey)
          setPendingId(null)
          intentRef.current = null
          setHasIntent(false)
          setPreview(null)
        } catch {
          setError(reasons.STORAGE_UNAVAILABLE)
          return
        }
        setError(describe(e))
      } else {
        // A retry rejection describes that attempt, not the unresolved original.
        // Only a receipt can resolve an earlier ambiguous request in this API.
        hadUnknownOutcome.current = true
        setError(reasons.SUBMISSION_UNKNOWN)
      }
    }
  }
  if (!z.uuid().safeParse(eventId).success || !validIndividual) {
    return (
      <section className='organizer-messages'>
        <h1>Audience unavailable</h1>
        <p role='alert'>{reasons.INVALID_SELECTOR}</p>
      </section>
    )
  }
  return (
    <section className='organizer-messages'>
      <Link className='ops-back' to={`/organizer/events/${eventId}/dashboard`}>
        ← Event dashboard
      </Link>
      <p className='organizer-messages__eyebrow'>Email Attendees</p>
      <h1>Message attendees about this event</h1>
      {receipt
        ? (
          <div role='status' className='organizer-messages__notice'>
            <h2 tabIndex={-1} ref={statusRef}>
              Message queued for {receipt.queuedRecipients} recipients.
            </h2>
            <p>
              Delivery continues after you leave this page. Queued does not mean
              delivered; some recipients may be suppressed or delivery may fail.
            </p>
          </div>
        )
        : pendingId
        ? (
          <div className='organizer-messages__notice'>
            <h2 tabIndex={-1} ref={statusRef}>Confirming your send</h2>
            <p>
              The original request may still be processing. Do not start another
              send. Checking an empty result does not mean the message was
              cancelled.
            </p>
            {error && <p role='alert'>{error}</p>}
            <button
              disabled={busy}
              onClick={() =>
                void run(async (current) => {
                  try {
                    const value = await messageApi.receipt(
                      ownerId,
                      eventId,
                      pendingId,
                    )
                    if (current()) {
                      if (value) complete(value)
                      else {setError(
                          'No receipt is available yet. Keep checking this original request.',
                        )}
                    }
                  } catch (e) {
                    if (current()) setError(describe(e))
                  }
                })}
            >
              Check send status
            </button>
            {hasIntent && (
              <button
                disabled={busy}
                onClick={() =>
                  void run((current) => submit(intentRef.current!, current))}
              >
                Retry same send
              </button>
            )}
            <p className='organizer-messages__muted'>
              After a reload, only status checks are available because message
              content is never saved in browser storage.
            </p>
          </div>
        )
        : (
          <>
            {error && (
              <div role='alert'>
                <h2 tabIndex={-1} ref={statusRef}>Message not ready</h2>
                <p>{error}</p>
              </div>
            )}
            {!options
              ? (
                <p role='status'>
                  {error
                    ? 'Return to the event or reload to try again.'
                    : 'Loading messaging options…'}
                </p>
              )
              : !options.canSend
              ? (
                <p role='alert'>
                  {reasons[options.reason ?? 'UNAVAILABLE'] ??
                    reasons.UNAVAILABLE}
                </p>
              )
              : (
                <>
                  <p className='organizer-messages__muted'>
                    Send a plain text update about this event. Each eligible
                    email address receives one message.
                  </p>
                  {!preview
                    ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          if (recovery.blocked) return
                          void run(async (current) => {
                            setError('')
                            try {
                              const value = await messageApi.preview(ownerId, {
                                eventId,
                                selector,
                                subject,
                                body,
                              })
                              if (current()) setPreview({ ...value, selector })
                            } catch (e) {
                              if (current()) {
                                setError(describe(e))
                              }
                            }
                          })
                        }}
                      >
                        <label>
                          Audience{order || registration
                            ? (
                              <input
                                readOnly
                                value={order
                                  ? 'Individual customer / order'
                                  : 'Individual registration'}
                              />
                            )
                            : (
                              <select
                                disabled={busy}
                                value={tier}
                                onChange={(e) => setTier(e.target.value)}
                              >
                                <option value=''>Everyone</option>
                                {options.admissionType === 'paid' &&
                                  options.tiers.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                      {t.archived ? ' (archived)' : ''}
                                    </option>
                                  ))}
                              </select>
                            )}
                        </label>
                        <label>
                          Subject<input
                            disabled={busy}
                            required
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                          />
                        </label>
                        <p className='organizer-messages__counter'>
                          {Array.from(subject.trim()).length} / 120 characters
                        </p>
                        <label>
                          Message<textarea
                            disabled={busy}
                            required
                            rows={9}
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                          />
                        </label>
                        <p className='organizer-messages__counter'>
                          {Array.from(body).length}{' '}
                          / 5,000 characters · Plain text; formatting and HTML
                          are not interpreted.
                        </p>
                        <button
                          className='ui-button ui-button--primary'
                          disabled={busy || recovery.blocked}
                          type='submit'
                        >
                          {busy ? 'Preparing preview…' : 'Preview'}
                        </button>
                      </form>
                    )
                    : (
                      <div>
                        <h2 tabIndex={-1} ref={statusRef}>Review your email</h2>
                        <p>
                          <strong>{preview.audienceLabel}</strong> ·{' '}
                          {preview.recipientCount} eligible recipients
                        </p>
                        <dl className='organizer-messages__envelope'>
                          <div>
                            <dt>From</dt>
                            <dd>{preview.from}</dd>
                          </div>
                          <div>
                            <dt>Reply-to</dt>
                            <dd>{preview.replyTo} (Wheretoo support)</dd>
                          </div>
                          <div>
                            <dt>Subject</dt>
                            <dd>{preview.subject}</dd>
                          </div>
                        </dl>
                        <EmailPreview html={preview.html} />
                        {!preview.canSend && (
                          <p role='alert'>
                            {reasons[preview.reason ?? 'NO_RECIPIENTS'] ??
                              reasons.NO_RECIPIENTS}
                          </p>
                        )}
                        <div className='organizer-messages__actions'>
                          <button
                            disabled={busy}
                            onClick={() => {
                              setPreview(null)
                              setError('')
                            }}
                          >
                            Edit message
                          </button>
                          {preview.canSend && preview.recipientCount > 0 && (
                            <button
                              className='ui-button ui-button--primary'
                              disabled={busy || recovery.blocked}
                              onClick={() =>
                                void run(async (current) => {
                                  const intent: Intent = {
                                    eventId,
                                    selector: preview.selector,
                                    subject: preview.subject,
                                    body: preview.body,
                                    fingerprint: preview.fingerprint,
                                    requestId: crypto.randomUUID(),
                                  }
                                  try {
                                    sessionStorage.setItem(
                                      storageKey,
                                      JSON.stringify({
                                        ownerId,
                                        eventId,
                                        requestId: intent.requestId,
                                      }),
                                    )
                                  } catch {
                                    setError(reasons.STORAGE_UNAVAILABLE)
                                    return
                                  }
                                  intentRef.current = intent
                                  setHasIntent(true)
                                  setPendingId(intent.requestId)
                                  setError('')
                                  await submit(intent, current)
                                })}
                            >
                              Send to {preview.recipientCount} people
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                </>
              )}
          </>
        )}
    </section>
  )
}
