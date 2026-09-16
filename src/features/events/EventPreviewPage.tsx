import { EventImageGallery } from '../event-images/EventImageGallery'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { adoptEventChangeCache } from '../event-changes/eventChanges.cache'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ReadState } from '../../components/ui/ReadState'
import { Button } from '../../components/ui/Button'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { useSession } from '../auth/SessionProvider'
import { moderationKeys } from '../moderation/moderation.queries'
import { useOrganizer } from '../organizers/organizer.queries'
import { useOwnedTicketTiers } from '../tickets/ticket.queries'
import { useConnectStatus } from '../payments/payment.queries'
import { eventRowToFormValues } from './event.api'
import { useEventChangeContext } from '../event-changes/eventChanges.queries'
import { EventChangeError, getEventChangeContext, publishIfCurrent } from '../event-changes/eventChanges.api'
import type { EventChangeContext } from '../event-changes/eventChanges.schemas'
import { eventPublishSchema, eventRepublishSchema } from './event.schemas'
import { EventAttendeePreview } from './EventAttendeePreview'
import { EventCreationLayout } from './EventCreationLayout'
import { EventPublishConfirmation } from './EventPublishConfirmation'
import { getPublishErrorMessage } from './publishErrors'

export function EventPreviewPage() {
  const { eventId = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const confirming = searchParams.get('mode') === 'confirm'
  const sessionState = useSession()
  const authenticatedOrganizerId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const routeIdentityKey = authenticatedOrganizerId + ':' + eventId
  const routeIdentity = useMemo(() => ({ key: routeIdentityKey }), [routeIdentityKey])
  const latestRouteIdentityRef = useRef(routeIdentity)
  const mountedRef = useRef(false)
  useLayoutEffect(() => { latestRouteIdentityRef.current = routeIdentity }, [routeIdentity])
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const contextQuery = useEventChangeContext(eventId, authenticatedOrganizerId)
  const [baseline, setBaseline] = useState<EventChangeContext | null>(null)
  const context = baseline?.event_id === eventId ? baseline : undefined
  if (contextQuery.data && !contextQuery.isFetching && !contextQuery.isError && baseline?.event_id !== eventId) setBaseline(contextQuery.data)
  const eventQuery = { ...contextQuery, data: context?.event }
  const requirementsQuery = { ...contextQuery, data: context?.requirements }
  const paidPreviewEventId = eventQuery.data?.admission_type === 'paid'
    ? eventId
    : ''
  const paidTiersQuery = useOwnedTicketTiers(authenticatedOrganizerId, paidPreviewEventId)
  const paidDraftEventId = eventQuery.data?.status === 'draft' ? paidPreviewEventId : ''
  const connectQuery = useConnectStatus(paidDraftEventId === '' ? '' : authenticatedOrganizerId, { fresh: true })
  const queryClient = useQueryClient()
  const persistedOrganizerId = eventQuery.data?.organizer_id ?? ''
  const organizerQuery = useOrganizer(persistedOrganizerId)
  const [publishState, setPublishState] = useState<'ready' | 'conflict' | 'unknown'>('ready')
  const activePublishEventIdRef = useRef<string | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [stripeRequiredFor, setStripeRequiredFor] = useState<typeof routeIdentity | null>(null)

  if (
    sessionState.status !== 'authenticated' ||
    ((eventQuery.isPending || eventQuery.data === undefined) && !eventQuery.isError)
  ) {
    return <ReadState headingAs="h1" paused={contextQuery.fetchStatus === 'paused'} status="loading" skeleton="detail-fields" title="Loading your preview" />
  }

  if (contextQuery.isError && contextQuery.error instanceof EventChangeError && contextQuery.error.kind === 'not_found') {
    return <ReadState headingAs="h1" status="unavailable" title="Event unavailable" description="The event may no longer be available." action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>} />
  }
  if (eventQuery.isError) {
    return (
      <ReadState headingAs="h1"
        action={<Button onClick={() => void eventQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="unavailable"
        title="Your preview could not load"
      />
    )
  }

  const event = eventQuery.data
  if (!event) {
    return (
      <ReadState headingAs="h1"
        action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>}
        description="The event may no longer be available."
        status="unavailable"
        title="Event unavailable"
      />
    )
  }

  if (event.status === 'cancelled') {
    return <Navigate replace to={`/organizer/events/${event.id}`} />
  }

  const isPaidDraft = event.status === 'draft' && event.admission_type === 'paid'
  const isPaidPreview = event.admission_type === 'paid'
  if (isPaidPreview && (paidTiersQuery.isPending || paidTiersQuery.data === undefined) && !paidTiersQuery.isError) {
    return <ReadState headingAs="h1" paused={paidTiersQuery.fetchStatus === 'paused'} status="loading" title="Loading ticket setup" />
  }
  if (isPaidPreview && paidTiersQuery.isError) {
    return (
      <ReadState headingAs="h1"
        action={<Button onClick={() => void paidTiersQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="unavailable"
        title="Ticket setup could not load"
      />
    )
  }

  if ((organizerQuery.isPending || organizerQuery.data === undefined) && !organizerQuery.isError) {
    return <ReadState headingAs="h1" paused={organizerQuery.fetchStatus === 'paused'} status="loading" title="Loading organizer details" />
  }

  if (organizerQuery.isError) {
    return (
      <ReadState headingAs="h1"
        action={<Button onClick={() => void organizerQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="unavailable"
        title="Organizer details could not load"
      />
    )
  }

  const organizer = organizerQuery.data
  if (organizer === null) {
    return (
      <ReadState headingAs="h1"
        action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>}
        description="The organizer profile may no longer be available."
        status="unavailable"
        title="Organizer details unavailable"
      />
    )
  }

  if ((requirementsQuery.isPending || requirementsQuery.data === undefined) && !requirementsQuery.isError) {
    return <ReadState headingAs="h1" paused={requirementsQuery.fetchStatus === 'paused'} status="loading" title="Loading event requirements" />
  }
  if (requirementsQuery.isError) {
    return (
      <ReadState headingAs="h1"
        action={<Button onClick={() => void requirementsQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="unavailable"
        title="Event requirements could not load"
      />
    )
  }
  const requirements = requirementsQuery.data
  if (!requirements) {
    return (
      <ReadState headingAs="h1"
        action={<Link className="ui-button ui-button--secondary" to={`/organizer/events/${event.id}/edit`}>Edit event</Link>}
        description="Return to the editor and save the event requirements before previewing."
        status="unavailable"
        title="Event requirements unavailable"
      />
    )
  }

  const needsPaidSetup = isPaidDraft && (paidTiersQuery.data?.length ?? 0) === 0
  const publicationSchema = event.status === 'published' ? eventRepublishSchema : eventPublishSchema
  const publishResult = needsPaidSetup ? null : publicationSchema.safeParse(eventRowToFormValues(event))
  const persistedEventId = event.id
  const savedStatus = event.status
  const validationMessages = publishResult === null || publishResult.success
    ? []
    : [...new Set(publishResult.error.issues.map((issue) => issue.message))]
  const publishDisabled = needsPaidSetup || requirements.needsAcceptance || publishResult === null
    || !publishResult.success || isPublishing || publishState !== 'ready'

  async function handlePublish() {
    if (publishDisabled || activePublishEventIdRef.current === persistedEventId) return
    if (savedStatus === 'draft' && !confirming) {
      setStripeRequiredFor(null)
      setSearchParams({ mode: 'confirm' })
      return
    }
    activePublishEventIdRef.current = persistedEventId
    setIsPublishing(true)
    setPublishError(null)
    const initiatingRouteIdentity = routeIdentity
    const accountIdentityIsCurrent = captureIdentityLifetime(queryClient, authenticatedOrganizerId)
    const isCurrent = () => mountedRef.current && latestRouteIdentityRef.current === initiatingRouteIdentity && accountIdentityIsCurrent()

    try {
      if (!context) throw new EventChangeError('unknown')
      const freshContext = await getEventChangeContext(persistedEventId, authenticatedOrganizerId)
      if (!isCurrent()) return
      const [freshTiers, freshConnect] = await Promise.all([
        isPaidDraft ? paidTiersQuery.refetch() : Promise.resolve(null),
        isPaidDraft ? connectQuery.refetch() : Promise.resolve(null),
      ])
      if (!isCurrent()) return
      if (freshContext.context_token !== context.context_token
        || (isPaidDraft && JSON.stringify(freshTiers?.data) !== JSON.stringify(paidTiersQuery.data))) {
        setBaseline(freshContext)
        adoptEventChangeCache(queryClient, freshContext)
        setSearchParams({})
        setPublishError('Saved event details changed. Review the updated preview before publishing.')
        return
      }
      if (isPaidDraft && (freshConnect?.isError || freshConnect?.data?.status !== 'ready')) {
        setStripeRequiredFor(initiatingRouteIdentity)
        return
      }
      const next = await publishIfCurrent(persistedEventId, authenticatedOrganizerId, freshContext.context_token)
      if (!isCurrent()) return
      const published = next.event
      if (published.id !== persistedEventId || published.organizer_id !== authenticatedOrganizerId || published.status !== 'published') {
        throw new EventChangeError('unknown')
      }
      setBaseline(next)
      adoptEventChangeCache(queryClient, next)
      queryClient.removeQueries({ queryKey: moderationKeys.publicEvent(persistedEventId), exact: true })
      navigate(`/organizer/events/${published.id}${savedStatus === 'draft' ? '?created=1' : ''}`)
    } catch (error) {
      if (!isCurrent()) return
      const conflict = error instanceof EventChangeError && error.kind === 'conflict'
      if (conflict) {
        setPublishState('conflict')
        setPublishError('Conflict: this version is out of date. Reload and review before publishing.')
      } else {
        try {
          const reconciled = await getEventChangeContext(persistedEventId, authenticatedOrganizerId)
          if (!isCurrent()) return
          if (reconciled.event.status === 'published') {
            adoptEventChangeCache(queryClient, reconciled)
            queryClient.removeQueries({ queryKey: moderationKeys.publicEvent(persistedEventId), exact: true })
            navigate(`/organizer/events/${persistedEventId}${savedStatus === 'draft' ? '?created=1' : ''}`)
            return
          }
          setBaseline(reconciled)
          adoptEventChangeCache(queryClient, reconciled)
          setPublishState('ready')
          const knownError = getPublishErrorMessage(error)
          setPublishError(knownError === 'Publishing failed. Try again.'
            ? 'Publication was not completed. Review the saved event before trying again.'
            : knownError)
          setSearchParams({})
        } catch {
          setPublishState('unknown')
          setPublishError('Unknown: the publication reply could not be verified. Reload and review the saved event before continuing.')
        }
      }
    } finally {
      if (activePublishEventIdRef.current === persistedEventId) activePublishEventIdRef.current = null
      setIsPublishing(false)
    }
  }

  if (stripeRequiredFor === routeIdentity && confirming) return <EventCreationLayout title="Set up payments to publish" step={7} admissionType="paid" onBack={() => {
    setStripeRequiredFor(null)
    setSearchParams({})
  }}>
    <h1>Set up payments to publish</h1><p>Your event and tickets are saved. Complete Stripe setup to publish paid tickets.</p>
    <Link className="ui-button ui-button--primary" to={`/organizer/settings/payments?eventId=${eventId}`}>Set up Stripe</Link>
    <Link className="ui-button ui-button--secondary" to="/organizer/events">Do this later</Link>
  </EventCreationLayout>

  const content = (
    <section aria-labelledby="event-preview-title" className="event-preview">
      <header className="event-preview__masthead">
        <div>
          <p className="organizer-eyebrow">Final check</p>
          <h1 id="event-preview-title">{confirming ? 'Ready to publish?' : 'Preview your event'}</h1>
          <p>This preview uses the latest version saved in Whereto.</p>
        </div>
        <Link className="ui-button ui-button--secondary" to={`/organizer/events/${event.id}/edit`}>
          {event.status === 'published' ? 'Edit event' : 'Edit draft'}
        </Link>
      </header>
      <Link to={`/organizer/events/${event.id}/changes`}>Review previous and new saved details / notices</Link>
      {publishState !== 'ready' ? <Button disabled={isPublishing} onClick={() => {
        if (activePublishEventIdRef.current) return
        activePublishEventIdRef.current = eventId
        setIsPublishing(true)
        void getEventChangeContext(eventId, authenticatedOrganizerId).then(next => { setBaseline(next); setPublishState('ready'); setPublishError(null) }, () => setPublishError('The saved event could not be loaded. Publication remains unknown.')).finally(() => { activePublishEventIdRef.current = null; setIsPublishing(false) })
      }} variant="secondary">Reload and review saved event</Button> : null}
      <EventImageGallery eventId={event.id} title={event.title ?? 'Event'} />
      {confirming ? <EventPublishConfirmation event={event} organizer={organizer} tiers={paidTiersQuery.data ?? []} /> : <EventAttendeePreview event={event} organizer={organizer} tiers={paidTiersQuery.data ?? []} />}
      {!confirming ? <section aria-labelledby="preview-requirements-title" className="event-preview__requirements">
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
      </section> : null}
      <footer className="event-preview__publish">
        {needsPaidSetup ? (
          <div id="publish-guidance">
            <p>Finish ticket setup, then confirm the current agreement and publish this version.</p>
            <Link className="ui-button ui-button--primary" to={`/organizer/events/${event.id}/tickets`}>Set up paid tickets</Link>
          </div>
        ) : (
          <>
            <div id="publish-guidance">
              <FormErrorSummary
                errors={publishError ? [...validationMessages, publishError] : validationMessages}
                title={publishError ? 'Publication needs review' : 'Complete before publishing'}
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
              {isPublishing
                ? 'Publishing…'
                : publishError
                  ? 'Try publishing again'
                  : confirming ? 'Confirm and publish' : event.status === 'published' ? 'Publish changes' : 'Publish event'}
            </Button>
          </>
        )}
      </footer>
    </section>
  )
  return event.status === 'draft' ? <EventCreationLayout admissionType={event.admission_type === 'paid' ? 'paid' : 'free'} backTo={confirming ? `/organizer/events/${event.id}/preview` : `/organizer/events/${event.id}/edit?step=details`} step={confirming ? 7 : 6} title={confirming ? 'Ready to publish?' : 'Preview your event'}>{content}</EventCreationLayout> : content
}
