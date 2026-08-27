import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { useSession } from '../auth/SessionProvider'
import { useOwnedEventRequirements } from '../moderation/moderation.queries'
import { useOrganizer } from '../organizers/organizer.queries'
import { eventRowToFormValues } from './event.api'
import { useOwnedEvent, usePublishEvent } from './event.queries'
import { eventPublishSchema } from './event.schemas'
import { EventSummary } from './EventSummary'
import { getPublishErrorMessage } from './publishErrors'

export function EventPreviewPage() {
  const { eventId = '' } = useParams()
  const navigate = useNavigate()
  const sessionState = useSession()
  const authenticatedOrganizerId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const eventQuery = useOwnedEvent(eventId, authenticatedOrganizerId)
  const requirementsQuery = useOwnedEventRequirements(authenticatedOrganizerId, eventId)
  const persistedOrganizerId = eventQuery.data?.organizer_id ?? ''
  const organizerQuery = useOrganizer(persistedOrganizerId)
  const publishMutation = usePublishEvent(persistedOrganizerId)
  const activePublishEventIdRef = useRef<string | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  if (
    sessionState.status !== 'authenticated' ||
    ((eventQuery.isPending || eventQuery.data === undefined) && !eventQuery.isError)
  ) {
    return <AsyncState status="loading" title="Loading your preview" />
  }

  if (eventQuery.isError) {
    return (
      <AsyncState
        action={<Button onClick={() => void eventQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="error"
        title="Your preview could not load"
      />
    )
  }

  const event = eventQuery.data
  if (event === null) {
    return (
      <AsyncState
        action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>}
        description="The event may no longer be available."
        status="empty"
        title="Event not found"
      />
    )
  }

  if (event.status === 'cancelled') {
    return <Navigate replace to={`/organizer/events/${event.id}`} />
  }

  if ((organizerQuery.isPending || organizerQuery.data === undefined) && !organizerQuery.isError) {
    return <AsyncState status="loading" title="Loading organizer details" />
  }

  if (organizerQuery.isError) {
    return (
      <AsyncState
        action={<Button onClick={() => void organizerQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="error"
        title="Organizer details could not load"
      />
    )
  }

  const organizer = organizerQuery.data
  if (organizer === null) {
    return (
      <AsyncState
        action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>}
        description="The organizer profile may no longer be available."
        status="empty"
        title="Organizer details unavailable"
      />
    )
  }

  if ((requirementsQuery.isPending || requirementsQuery.data === undefined) && !requirementsQuery.isError) {
    return <AsyncState status="loading" title="Loading event requirements" />
  }
  if (requirementsQuery.isError) {
    return (
      <AsyncState
        action={<Button onClick={() => void requirementsQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="error"
        title="Event requirements could not load"
      />
    )
  }
  const requirements = requirementsQuery.data
  if (requirements === null) {
    return (
      <AsyncState
        action={<Link className="ui-button ui-button--secondary" to={`/organizer/events/${event.id}/edit`}>Edit event</Link>}
        description="Return to the editor and save the event requirements before previewing."
        status="empty"
        title="Event requirements unavailable"
      />
    )
  }

  const needsPaidSetup = event.admission_type === 'paid' && event.status === 'draft'
  const publishResult = needsPaidSetup ? null : eventPublishSchema.safeParse(eventRowToFormValues(event))
  const persistedEventId = event.id
  const validationMessages = publishResult === null || publishResult.success
    ? []
    : [...new Set(publishResult.error.issues.map((issue) => issue.message))]
  const publishDisabled = needsPaidSetup || requirements.needsAcceptance || publishResult === null
    || !publishResult.success || isPublishing || publishMutation.isPending

  async function handlePublish() {
    if (publishDisabled || activePublishEventIdRef.current === persistedEventId) return
    activePublishEventIdRef.current = persistedEventId
    setIsPublishing(true)
    setPublishError(null)

    try {
      const published = await publishMutation.mutateAsync(persistedEventId)
      if (published.id !== persistedEventId || published.organizer_id !== authenticatedOrganizerId || published.status !== 'published') {
        setPublishError('Publishing failed. Try again.')
        return
      }
      navigate(`/organizer/events/${published.id}`)
    } catch (error) {
      setPublishError(getPublishErrorMessage(error))
    } finally {
      if (activePublishEventIdRef.current === persistedEventId) activePublishEventIdRef.current = null
      setIsPublishing(false)
    }
  }

  return (
    <section aria-labelledby="event-preview-title" className="event-preview">
      <header className="event-preview__masthead">
        <div>
          <p className="organizer-eyebrow">Final check</p>
          <h1 id="event-preview-title">Preview your event</h1>
          <p>This preview uses the latest version saved in Whereto.</p>
        </div>
        <Link className="ui-button ui-button--secondary" to={`/organizer/events/${event.id}/edit`}>
          {event.status === 'published' ? 'Edit event' : 'Edit draft'}
        </Link>
      </header>
      <EventSummary event={event} organizer={organizer} />
      <section aria-labelledby="preview-requirements-title" className="event-preview__requirements">
        <header>
          <p className="organizer-eyebrow">Saved with this event</p>
          <h2 id="preview-requirements-title">Event requirements</h2>
        </header>
        <dl className="event-preview__requirements-grid">
          <div><dt>Minimum age</dt><dd>{requirements.minimumAge === 'all_ages' ? 'All ages' : requirements.minimumAge === '18_plus' ? '18+' : '21+'}</dd></div>
          <div><dt>Alcohol</dt><dd>{requirements.alcoholPresent ? 'Alcohol present' : 'No alcohol disclosed'}</dd></div>
          <div><dt>Cannabis</dt><dd>{requirements.cannabisPresent ? 'Cannabis present' : 'No cannabis disclosed'}</dd></div>
          <div><dt>Adult content</dt><dd>{requirements.explicitAdultContent ? 'Disclosed' : 'Not disclosed'}</dd></div>
          <div><dt>Gambling</dt><dd>{requirements.gamblingPresent ? 'Disclosed' : 'Not disclosed'}</dd></div>
          <div><dt>Weapons</dt><dd>{requirements.weaponsPresent ? 'Disclosed' : 'Not disclosed'}</dd></div>
          <div><dt>High-risk activity</dt><dd>{requirements.highRiskActivity ? 'Disclosed' : 'Not disclosed'}</dd></div>
        </dl>
        <p className="event-preview__policies">
          Policies: <a href={requirements.organizerTerms.publicUrl}>{requirements.organizerTerms.label}</a>{' and '}
          <a href={requirements.eventPolicy.publicUrl}>{requirements.eventPolicy.label}</a>
        </p>
        <p className="event-preview__agreement" role="status">
          {requirements.needsAcceptance ? 'Agreement required before publishing.' : 'Agreement current for this saved event.'}
        </p>
      </section>
      <footer className="event-preview__publish">
        {needsPaidSetup ? (
          <div id="publish-guidance">
            <p>Finish ticket setup and activate paid sales from the ticket tiers page.</p>
            <Link className="ui-button ui-button--primary" to={`/organizer/events/${event.id}/tickets`}>Set up paid tickets</Link>
          </div>
        ) : (
          <>
            <div id="publish-guidance">
              <FormErrorSummary
                errors={publishError ? [...validationMessages, publishError] : validationMessages}
                title={publishError ? 'Event was not published' : 'Complete before publishing'}
              />
              {validationMessages.length === 0 && publishError === null && !requirements.needsAcceptance ? (
                <p>Publishing submits this saved version and returns its current status.</p>
              ) : requirements.needsAcceptance ? (
                <p>Return to the editor to confirm the current agreement.</p>
              ) : null}
            </div>
            <Button
              aria-describedby="publish-guidance"
              disabled={publishDisabled}
              onClick={() => void handlePublish()}
            >
              {isPublishing || publishMutation.isPending
                ? 'Publishing…'
                : publishError
                  ? 'Try publishing again'
                  : event.status === 'published' ? 'Publish changes' : 'Publish event'}
            </Button>
          </>
        )}
      </footer>
    </section>
  )
}
