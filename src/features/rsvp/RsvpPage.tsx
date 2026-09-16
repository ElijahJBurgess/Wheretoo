import { usePublicEventImages } from '../event-images/publicEventImages'
import { ReadState } from '../../components/ui/ReadState'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BuyerEventSummary, BuyerHeader, BuyerIcon } from '../buyer-journey/BuyerPrimitives'
import { formatBuyerSchedule } from '../buyer-journey/format'
import { type FreeAttemptResult, normalizeFreeSubmission } from './rsvp.contract'
import {
  prepareAttempt,
  readAttempt,
  recordResult,
  type RsvpAttempt,
  validateAttempt,
  withRsvpLock,
} from './rsvp.attempt'
import { type FreeRsvpEvent, rsvpApi } from './rsvp.api'
import './rsvp.css'
export function RsvpProgress({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className='buyer-progress' aria-label='RSVP progress'>
      {['Tickets', 'Details', 'Confirmation'].map((label, index) => (
        <li
          key={label}
          className={index + 1 <= step ? 'is-active' : ''}
          aria-current={index + 1 === step ? 'step' : undefined}
        >
          <span className='buyer-progress__dot'>{index + 1}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  )
}
export function RsvpPage() {
  const { eventId = '' } = useParams()
  const images = usePublicEventImages([eventId])
  const navigate = useNavigate()
  const [event, setEvent] = useState<FreeRsvpEvent | null>()
  const [eventError, setEventError] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [quantity, setQuantity] = useState(1)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [attempt, setAttempt] = useState<RsvpAttempt | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState(false)
  const [newIntent, setNewIntent] = useState(false)
  async function loadEvent() {
    setEventError(false)
    try {
      setEvent(await rsvpApi.event(eventId))
    } catch {
      setEventError(true)
    }
  }
  function acceptResult(saved: RsvpAttempt, result: FreeAttemptResult) {
    const next = recordResult(saved, result)
    setAttempt(next)
    if (next.state === 'confirmed') {
      navigate('/rsvp/' + next.collectionBearer)
      return
    }
    if (result.kind === 'rejected') {
      setError(
        result.reason === 'full'
          ? `There is not enough room for this quantity.${
            result.remaining === undefined
              ? ''
              : ` ${result.remaining} admission${result.remaining === 1 ? '' : 's'} remain.`
          } Update your selection.`
          : result.reason === 'invalid_input'
          ? 'Check your name, email and quantity.'
          : 'This event is no longer accepting RSVPs.',
      )
      void loadEvent()
    } else {setError(
        result.kind === 'conflict'
          ? 'This request has different saved details. Keep the original private link and resolve that RSVP.'
          : 'We cannot confirm your RSVP yet. Check the same request again; do not start another registration.',
      )}
  }
  async function resolve(saved: RsvpAttempt, replay: boolean) {
    setBusy(true)
    setError('')
    try {
      await withRsvpLock(eventId, async () => {
        const current = readAttempt(eventId)
        if (!current || current.requestId !== saved.requestId) {
          throw new Error('Your saved request changed. Reload to recover it.')
        }
        await validateAttempt(current)
        const result = await rsvpApi.resolve(current)
        acceptResult(
          current,
          result.kind === 'not_found' && replay ? await rsvpApi.confirm(current) : result,
        )
      })
    } catch {
      setError('Your RSVP is not confirmed yet. Check its status before trying anything else.')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let active = true
    void Promise.resolve().then(async () => {
      if (!active) return
      try {
        const saved = readAttempt(eventId)
        const marker = new URLSearchParams(window.location.hash.slice(1)).get('attempt')
        if (marker && (!saved || saved.requestId !== marker)) {
          throw new Error(
            'Your saved RSVP needs recovery. Use your existing private link; do not submit again.',
          )
        }
        if (saved) {
          await validateAttempt(saved)
          setAttempt(saved)
          setName(saved.submission.name)
          setEmail(saved.submission.email)
          setQuantity(saved.submission.quantity)
          setStep(2)
          if (saved.state === 'unresolved') void resolve(saved, false)
        }
      } catch (e) {
        setBlocked(true)
        setError(e instanceof Error ? e.message : 'Private RSVP recovery unavailable.')
      }
      await loadEvent()
    })
    const changed = (e: StorageEvent) => {
      if (e.key === null || e.key === 'wheretoo.rsvp.v1:' + eventId) {
        void Promise.resolve().then(async () => {
          try {
            const saved = readAttempt(eventId)
            if (!saved) throw new Error()
            await validateAttempt(saved)
            setAttempt(saved)
            if (saved.state === 'confirmed') navigate('/rsvp/' + saved.collectionBearer)
          } catch {
            setBlocked(true)
            setError('Your saved RSVP needs recovery. Keep your private link.')
          }
        })
      }
    }
    window.addEventListener('storage', changed)
    return () => {
      active = false
      window.removeEventListener('storage', changed)
    }
    // The event route owns initialization; network callbacks must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    let submission
    try {
      submission = normalizeFreeSubmission({ eventId, quantity, name, email })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check your details.')
      return
    }
    setBusy(true)
    try {
      await withRsvpLock(eventId, async () => {
        const previous = readAttempt(eventId)
        const marker = new URLSearchParams(window.location.hash.slice(1)).get('attempt')
        if (marker && previous?.requestId !== marker) {
          setBlocked(true)
          throw new Error('Your saved RSVP needs recovery. Do not submit another request.')
        }
        if (previous) await validateAttempt(previous)
        const saved = await prepareAttempt(submission, localStorage, newIntent)
        setAttempt(saved)
        setNewIntent(false)
        window.history.replaceState(
          window.history.state,
          '',
          window.location.pathname + window.location.search + '#attempt=' + saved.requestId,
        )
        if (saved.state === 'confirmed') {
          navigate('/rsvp/' + saved.collectionBearer)
          return
        }
        if (previous?.requestId === saved.requestId) {
          const result = await rsvpApi.resolve(saved)
          if (result.kind !== 'not_found') {
            acceptResult(saved, result)
            return
          }
        }
        acceptResult(saved, await rsvpApi.confirm(saved))
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your RSVP is not confirmed yet. Check its status.')
      try {
        setAttempt(readAttempt(eventId))
      } catch {
        setBlocked(true)
      }
    } finally {
      setBusy(false)
    }
  }
  const unresolved = attempt?.state === 'unresolved'
  const confirmed = attempt?.state === 'confirmed' && !newIntent
  const summary = event?.event
  return (
    <main className='buyer-page buyer-rsvp'>
      <BuyerHeader
        back={
          <Link
            className='buyer-icon-button'
            aria-label='Return to event'
            to={'/events/' + eventId}
          >
            <BuyerIcon name='back' />
          </Link>
        }
      />
      <RsvpProgress step={step} />
      <div className='buyer-content'>
        {summary && (
          <BuyerEventSummary
            title={summary.title}
            organizer={summary.organizer.display_name}
            schedule={formatBuyerSchedule(summary.starts_at, summary.ends_at, summary.timezone)}
            venue={summary.venue_name ?? 'Venue to be announced'}
            location={`${summary.address_line1}, ${summary.city}`}
            artwork={images.data?.find(image => image.position === 1)?.url ?? null}
          />
        )}
        {error && <p className='rsvp-notice' role='alert'>{error}</p>}
        {busy && <p role='status' aria-live='polite'>Confirming your RSVP…</p>}
        {blocked
          ? (
            <section>
              <h1>Private RSVP recovery needed</h1>
              <p>
                Use your existing private ticket link. Do not create another registration to replace
                an uncertain request.
              </p>
            </section>
          )
          : unresolved
          ? (
            <section>
              <h1>{busy ? 'Confirming your RSVP' : 'Check your RSVP'}</h1>
              <p>
                Your request for {attempt.submission.quantity}{' '}
                admission{attempt.submission.quantity === 1 ? '' : 's'}{' '}
                is saved. Checking again uses that same request.
              </p>
              <button
                className='ui-button buyer-primary'
                disabled={busy}
                onClick={() => void resolve(attempt, true)}
              >
                Check RSVP status
              </button>
            </section>
          )
          : confirmed
          ? (
            <section>
              <h1>Your RSVP is confirmed</h1>
              <Link className='ui-button buyer-primary' to={'/rsvp/' + attempt.collectionBearer}>
                View your tickets
              </Link>
              <button
                className='ui-button buyer-secondary'
                onClick={() => {
                  setNewIntent(true)
                  setAttempt(null)
                  setStep(1)
                  setQuantity(1)
                  setError('')
                  window.history.replaceState(window.history.state, '', window.location.pathname)
                }}
              >
                Start another RSVP
              </button>
            </section>
          )
          : eventError
          ? (
            <ReadState headingAs='h1' status='unavailable' title='Availability could not be checked' action={<button className='ui-button buyer-primary' onClick={() => void loadEvent()}>Check availability</button>} />
          )
          : event === undefined
          ? <ReadState headingAs='h1' status='loading' skeleton='detail-fields' title='Loading event…' />
          : event === null
          ? (
            <ReadState headingAs='h1' status='unavailable' title='RSVP unavailable' description='This event may have ended or may no longer be available.' />
          )
          : event.availability.status === 'full'
          ? (
            <section className='rsvp-notice'>
              <h1>RSVP capacity reached</h1>
              <p>This event has reached capacity.</p>
              <button className='ui-button buyer-secondary' disabled>RSVP full</button>
              <button className='ui-button buyer-secondary' onClick={() => void loadEvent()}>
                Check availability
              </button>
            </section>
          )
          : step === 1
          ? (
            <section>
              <h1>Choose your RSVP</h1>
              <div className='rsvp-quantity'>
                <BuyerIcon name='ticket' />
                <div>
                  <strong>Free RSVP</strong>
                  <small>General Admission</small>
                </div>
                <span>$0</span>
                <button
                  aria-label='Decrease quantity'
                  disabled={quantity <= 1}
                  onClick={() => setQuantity((q) => q - 1)}
                >
                  −
                </button>
                <output aria-label='Quantity'>{quantity}</output>
                <button
                  aria-label='Increase quantity'
                  disabled={quantity >= Math.min(10, event.availability.remaining ?? 10)}
                  onClick={() => setQuantity((q) => q + 1)}
                >
                  +
                </button>
              </div>
              <p className='rsvp-notice'>No payment required.</p>
              <p>
                Availability is checked when you confirm. Selecting a quantity does not reserve
                places.
              </p>
              <button
                className='ui-button buyer-primary'
                disabled={quantity > Math.min(10, event.availability.remaining ?? 10)}
                onClick={() => setStep(2)}
              >
                Continue
              </button>
            </section>
          )
          : (
            <form noValidate onSubmit={(e) => void submit(e)}>
              <h1>Your details</h1>
              <div className='buyer-details__fields'>
                <label htmlFor='rsvp-name'>
                  Full name<input
                    id='rsvp-name'
                    autoComplete='name'
                    maxLength={200}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label htmlFor='rsvp-email'>
                  Email address<input
                    id='rsvp-email'
                    type='email'
                    autoComplete='email'
                    maxLength={320}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              </div>
              <section className='rsvp-summary'>
                <h2>RSVP summary</h2>
                <p>Free RSVP × {quantity}</p>
                <p>
                  <strong>Total — Free</strong>
                </p>
                <button className='rsvp-text-button' type='button' onClick={() => setStep(1)}>
                  Edit quantity
                </button>
              </section>
              <button className='ui-button buyer-primary' disabled={busy} type='submit'>
                Confirm RSVP
              </button>
            </form>
          )}
      </div>
    </main>
  )
}
