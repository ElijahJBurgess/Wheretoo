import { useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { useSession } from '../auth/SessionProvider'
import {
  useCurrentEventReviewRequest,
  usePublicEvent,
  useRequestEventReview,
  useWithdrawEventReview,
} from '../moderation/moderation.queries'
import { useOrganizer } from '../organizers/organizer.queries'
import { useOwnedEvent } from './event.queries'
import { EventSummary } from './EventSummary'
import type { EventRow } from './event.types'

const publishedAtFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatPublishedAt(value: string | null): string {
  if (value === null) return 'Publication time unavailable'
  const instant = new Date(value)
  return Number.isNaN(instant.getTime())
    ? 'Publication time unavailable'
    : `Published ${publishedAtFormatter.format(instant)}`
}

function formatReviewRequestedAt(value: string): string {
  const instant = new Date(value)
  return Number.isNaN(instant.getTime())
    ? 'Review requested.'
    : `Review requested ${publishedAtFormatter.format(instant)}.`
}

function organizerStatus(event: EventRow) {
  if (event.status === 'cancelled') {
    return { heading: 'Cancelled', label: null, copy: 'This event is not publicly available.' }
  }
  if (event.moderation_status === 'blocked') {
    return { heading: 'Blocked', label: 'Blocked', copy: 'This event is blocked from public discovery.' }
  }
  if (event.moderation_status === 'removed') {
    return { heading: 'Removed', label: 'Removed', copy: 'This event has been removed from public discovery.' }
  }
  if (event.moderation_status === 'under_review' || event.moderation_status === 'not_evaluated') {
    return { heading: 'Under review', label: 'Under review', copy: 'This event is not currently available in public discovery.' }
  }
  return { heading: 'Published', label: null, copy: 'This event is not currently available in public discovery.' }
}

export function PublishedEventPage() {
  const { eventId = '' } = useParams()
  const sessionState = useSession()
  const authenticatedOrganizerId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const eventQuery = useOwnedEvent(eventId, authenticatedOrganizerId)
  const persistedOrganizerId = eventQuery.data?.organizer_id ?? ''
  const organizerQuery = useOrganizer(persistedOrganizerId)
  const publicEventQuery = usePublicEvent(eventId)
  const reviewQuery = useCurrentEventReviewRequest(authenticatedOrganizerId, eventId)
  const requestReviewMutation = useRequestEventReview(authenticatedOrganizerId, eventId)
  const withdrawReviewMutation = useWithdrawEventReview(authenticatedOrganizerId, eventId)
  const [reviewNote, setReviewNote] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null)
  const activeReviewActionRef = useRef<'request' | 'withdraw' | null>(null)
  const requestButtonRef = useRef<HTMLButtonElement | null>(null)
  const reviewStatusRef = useRef<HTMLParagraphElement | null>(null)

  if (
    sessionState.status !== 'authenticated' ||
    ((eventQuery.isPending || eventQuery.data === undefined) && !eventQuery.isError)
  ) {
    return <AsyncState status="loading" title="Loading published event" />
  }
  if (eventQuery.isError) {
    return <AsyncState action={<Button onClick={() => void eventQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="error" title="Published event could not load" />
  }
  const event = eventQuery.data
  if (event === null) {
    return <AsyncState action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>} description="The event may no longer be available." status="empty" title="Event not found" />
  }
  if (event.status === 'draft') {
    return <Navigate replace to={`/organizer/events/${event.id}/edit`} />
  }
  if ((organizerQuery.isPending || organizerQuery.data === undefined) && !organizerQuery.isError) {
    return <AsyncState status="loading" title="Loading organizer details" />
  }
  if (organizerQuery.isError) {
    return <AsyncState action={<Button onClick={() => void organizerQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="error" title="Organizer details could not load" />
  }
  const organizer = organizerQuery.data
  if (organizer === null) {
    return <AsyncState action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>} description="The organizer profile may no longer be available." status="empty" title="Organizer details unavailable" />
  }

  const isPublished = event.status === 'published'
  const status = organizerStatus(event)
  const isPublic = isPublished && !publicEventQuery.isError && publicEventQuery.data !== undefined && publicEventQuery.data !== null
  const canSetUpPaidTickets = isPublic && event.admission_type === 'free'
  const canRequestReview = isPublished && ['under_review', 'blocked', 'removed'].includes(event.moderation_status)
  const currentReview = reviewQuery.data
  const reviewIsBusy = requestReviewMutation.isPending || withdrawReviewMutation.isPending

  async function requestReview() {
    if (activeReviewActionRef.current !== null || requestReviewMutation.isPending || withdrawReviewMutation.isPending) return
    activeReviewActionRef.current = 'request'
    setReviewError(null)
    setReviewFeedback(null)
    try {
      await requestReviewMutation.mutateAsync(reviewNote.trim())
      setReviewNote('')
      setReviewFeedback('Review requested.')
      reviewStatusRef.current?.focus()
    } catch {
      setReviewError('Review request could not be sent. Try again.')
      requestButtonRef.current?.focus()
    } finally {
      activeReviewActionRef.current = null
    }
  }

  async function withdrawReview() {
    if (activeReviewActionRef.current !== null || requestReviewMutation.isPending || withdrawReviewMutation.isPending) return
    activeReviewActionRef.current = 'withdraw'
    setReviewError(null)
    setReviewFeedback(null)
    try {
      await withdrawReviewMutation.mutateAsync()
      setReviewFeedback('Review request withdrawn.')
      reviewStatusRef.current?.focus()
    } catch {
      setReviewError('Review request could not be withdrawn. Try again.')
    } finally {
      activeReviewActionRef.current = null
    }
  }

  return (
    <section aria-labelledby="published-event-title" className="published-event">
      <header className="published-event__status">
        <div>
          <p className="organizer-eyebrow">Event status</p>
          <h1 id="published-event-title">{status.heading}</h1>
          {isPublished ? <p>{formatPublishedAt(event.published_at)}</p> : null}
        </div>
        {status.label ? (
          <strong className={`event-operational-state${status.heading === 'Under review' ? ' event-operational-state--review' : ''}`}>
            {status.label}
          </strong>
        ) : null}
      </header>
      <div aria-live="polite" className={`published-event__notice${isPublic ? ' published-event__notice--public' : ''}`}>
        {isPublic
          ? <p>This event is publicly available.</p>
          : publicEventQuery.isError
            ? (
                <div>
                  <p>Public availability could not be confirmed.</p>
                  <Button onClick={() => void publicEventQuery.refetch()} variant="secondary">Check public availability again</Button>
                </div>
              )
            : publicEventQuery.isPending || publicEventQuery.data === undefined
              ? <p>Checking public availability…</p>
              : <p>{status.copy}</p>}
      </div>
      <EventSummary event={event} organizer={organizer} />
      {canRequestReview ? (
        <section aria-labelledby="review-request-title" className="review-request">
          <header>
            <p className="organizer-eyebrow">One current request</p>
            <h2 id="review-request-title">Request review</h2>
            <p>Ask Whereto to review this saved version. You can include one optional note.</p>
          </header>
          {reviewQuery.isPending || reviewQuery.data === undefined ? (
            <p role="status">Loading review request status…</p>
          ) : reviewQuery.isError ? (
            <div className="review-request__error" role="alert">
              <p>Review request status could not load.</p>
              <Button onClick={() => void reviewQuery.refetch()} variant="secondary">Try again</Button>
            </div>
          ) : currentReview?.status === 'open' ? (
            <div className="review-request__current">
              <p ref={reviewStatusRef} role="status" tabIndex={-1}>
                {reviewFeedback ?? formatReviewRequestedAt(currentReview.createdAt)}
              </p>
              {reviewError ? <p role="alert">{reviewError}</p> : null}
              <Button disabled={reviewIsBusy} onClick={() => void withdrawReview()} variant="secondary">
                {withdrawReviewMutation.isPending ? 'Withdrawing…' : reviewError ? 'Try withdrawing again' : 'Withdraw request'}
              </Button>
            </div>
          ) : (
            <div className="review-request__form">
              {currentReview ? (
                <p ref={reviewStatusRef} role="status" tabIndex={-1}>
                  {reviewFeedback ?? (currentReview.status === 'withdrawn' ? 'Review request withdrawn. You can request review again.' : 'The previous review request was resolved.')}
                </p>
              ) : reviewFeedback ? <p ref={reviewStatusRef} role="status" tabIndex={-1}>{reviewFeedback}</p> : null}
              <label htmlFor="review-note">Optional note</label>
              <textarea
                id="review-note"
                maxLength={1000}
                onChange={(input) => setReviewNote(input.target.value)}
                rows={4}
                value={reviewNote}
              />
              {reviewError ? <p className="review-request__error" role="alert">{reviewError}</p> : null}
              <Button
                disabled={reviewIsBusy}
                onClick={() => void requestReview()}
                ref={requestButtonRef}
              >
                {requestReviewMutation.isPending ? 'Requesting…' : reviewError ? 'Try requesting review again' : 'Request review'}
              </Button>
            </div>
          )}
        </section>
      ) : null}
      <footer className="published-event__actions">
        {canSetUpPaidTickets ? <Link className="ui-button ui-button--primary" to={`/organizer/events/${event.id}/tickets`}>Set up paid tickets</Link> : null}
        <Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>
      </footer>
    </section>
  )
}
