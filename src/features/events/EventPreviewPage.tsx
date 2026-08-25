import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { useSession } from '../auth/SessionProvider'
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

  if (event.status !== 'draft') {
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

  const publishResult = eventPublishSchema.safeParse(eventRowToFormValues(event))
  const persistedEventId = event.id
  const validationMessages = publishResult.success
    ? []
    : [...new Set(publishResult.error.issues.map((issue) => issue.message))]
  const publishDisabled = !publishResult.success || isPublishing || publishMutation.isPending

  async function handlePublish() {
    if (publishDisabled || activePublishEventIdRef.current === persistedEventId) return
    activePublishEventIdRef.current = persistedEventId
    setIsPublishing(true)
    setPublishError(null)

    try {
      const published = await publishMutation.mutateAsync(persistedEventId)
      if (published.status !== 'published') {
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
        <Link className="ui-button ui-button--secondary" to={`/organizer/events/${event.id}/edit`}>Edit draft</Link>
      </header>
      <EventSummary event={event} organizer={organizer} />
      <footer className="event-preview__publish">
        <div id="publish-guidance">
          <FormErrorSummary
            errors={publishError ? [...validationMessages, publishError] : validationMessages}
            title={publishError ? 'Event was not published' : 'Complete before publishing'}
          />
          {validationMessages.length === 0 && publishError === null ? (
            <p>Your event is ready. Publishing makes it immediately discoverable.</p>
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
              : 'Publish event'}
        </Button>
      </footer>
    </section>
  )
}
