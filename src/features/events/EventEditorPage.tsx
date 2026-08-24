import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useBeforeUnload, useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { StepRail } from '../../components/ui/StepRail'
import { useSession } from '../auth/SessionProvider'
import { eventRowToFormValues } from './event.api'
import { EventDetailsStep } from './EventDetailsStep'
import { EventReviewStep } from './EventReviewStep'
import { EventScheduleLocationStep } from './EventScheduleLocationStep'
import { useOwnedEvent, useSaveEventDraft } from './event.queries'
import { eventDraftSchema } from './event.schemas'
import type { EventFormValues, EventRow, NormalizedLocation } from './event.types'

const steps = ['Details', 'Schedule & location', 'Review'] as const
const emptyEvent: EventFormValues = {
  title: '', description: '', category: '', startsAt: '', endsAt: '',
  timezone: 'America/Los_Angeles', venueName: '', location: null,
  admissionType: 'free', capacity: null,
}

function saveErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : 'Check your connection, then try saving again.'
}

export function EventEditorPage() {
  const { eventId: routeEventId } = useParams()
  const navigate = useNavigate()
  const routeLocation = useLocation()
  const sessionState = useSession()
  const organizerId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const eventId = routeEventId ?? ''
  const isNew = eventId === ''
  const eventQuery = useOwnedEvent(eventId, organizerId)
  const saveMutation = useSaveEventDraft()
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1)
  const [serverError, setServerError] = useState<string | null>(null)
  const hydratedEventIdRef = useRef<string | null>(null)
  const approvedNavigationRef = useRef(false)
  const activeActionRef = useRef<'save' | 'preview' | null>(null)
  const {
    control,
    formState: { errors, isDirty, isSubmitting },
    getValues,
    handleSubmit,
    register,
    reset,
    setValue,
  } = useForm<EventFormValues>({ resolver: zodResolver(eventDraftSchema), defaultValues: emptyEvent, mode: 'onChange' })

  const location = useWatch({ control, name: 'location' })
  const title = useWatch({ control, name: 'title' })
  const isBusy = isSubmitting || saveMutation.isPending
  const shouldBlockNavigation = useCallback(
    () => isDirty && !approvedNavigationRef.current,
    [isDirty],
  )
  const blocker = useBlocker(shouldBlockNavigation)

  useBeforeUnload(useCallback((event) => {
    if (isDirty && !approvedNavigationRef.current) {
      event.preventDefault()
      event.returnValue = ''
    }
  }, [isDirty]))

  useEffect(() => {
    if (eventQuery.data && hydratedEventIdRef.current !== eventQuery.data.id) {
      reset(eventRowToFormValues(eventQuery.data))
      hydratedEventIdRef.current = eventQuery.data.id
    }
  }, [eventQuery.data, reset])

  useEffect(() => {
    approvedNavigationRef.current = false
  }, [routeLocation.key])

  function setLocation(locationValue: NormalizedLocation | null) {
    setValue('location', locationValue, { shouldDirty: true, shouldValidate: true })
  }

  function navigateApproved(to: string, replace = false) {
    approvedNavigationRef.current = true
    void navigate(to, { replace })
  }

  async function persist(valuesToSave: EventFormValues): Promise<EventRow> {
    const saved = await saveMutation.mutateAsync({
      eventId: isNew ? null : eventId,
      organizerId,
      values: valuesToSave,
    })
    reset(eventRowToFormValues(saved))
    hydratedEventIdRef.current = saved.id
    return saved
  }

  const submitAction = (action: 'save' | 'preview') => {
    if (activeActionRef.current !== null) return
    activeActionRef.current = action
    setServerError(null)

    void handleSubmit(async (formValues) => {
      try {
        if (action === 'preview' && !isNew && !isDirty) {
          navigateApproved(`/organizer/events/${eventId}/preview`)
          return
        }
        const saved = await persist(formValues)
        navigateApproved(
          action === 'preview'
            ? `/organizer/events/${saved.id}/preview`
            : `/organizer/events/${saved.id}/edit`,
          action === 'save' && isNew,
        )
      } catch (error) {
        setServerError(saveErrorMessage(error))
      } finally {
        activeActionRef.current = null
      }
    }, () => {
      activeActionRef.current = null
      setServerError(null)
    })()
  }

  if (
    sessionState.status !== 'authenticated' ||
    (!isNew && (eventQuery.isPending || eventQuery.data === undefined) && !eventQuery.isError)
  ) {
    return <AsyncState status="loading" title="Loading your event" />
  }
  if (!isNew && eventQuery.isError) {
    return <AsyncState action={<Button onClick={() => void eventQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="error" title="Your event could not load" />
  }
  if (!isNew && eventQuery.data === null) {
    return <AsyncState action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>} description="The event may no longer be available." status="empty" title="Event not found" />
  }
  if (!isNew && eventQuery.data?.status !== 'draft') {
    return <AsyncState action={<Link className="ui-button ui-button--secondary" to={`/organizer/events/${eventId}`}>View event</Link>} description="Published events are read-only in this milestone." status="empty" title="This event is already published" />
  }

  const validationMessages = Object.values(errors).flatMap((error) => error?.message ? [String(error.message)] : [])
  const summaryErrors = serverError ? [...validationMessages, serverError] : validationMessages
  const saveLabel = isBusy ? 'Saving…' : 'Save draft'

  return (
    <section aria-labelledby="event-editor-title" className="event-editor">
      <header className="event-editor__masthead">
        <div>
          <p className="organizer-eyebrow">{isNew ? 'New event' : 'Event draft'}</p>
          <h1 id="event-editor-title">{title.trim() || 'Untitled event'}</h1>
        </div>
        <p className={`event-save-state${isDirty ? ' event-save-state--dirty' : ''}`} aria-live="polite">
          {isDirty || isNew ? 'Unsaved' : 'Saved'}
        </p>
      </header>
      <div className="event-editor__frame">
        <aside className="event-editor__rail"><StepRail current={activeStep} labels={steps} /></aside>
        <form className="event-editor__form" noValidate onSubmit={(event) => event.preventDefault()}>
          <FormErrorSummary errors={summaryErrors} title={serverError ? 'Draft could not be saved' : 'Check the highlighted fields'} />
          {activeStep === 1 ? <EventDetailsStep errors={errors} register={register} /> : null}
          {activeStep === 2 ? <EventScheduleLocationStep errors={errors} location={location} onLocationChange={setLocation} register={register} /> : null}
          {activeStep === 3 ? <EventReviewStep values={getValues()} /> : null}
          <div className="event-editor__actions">
            {activeStep > 1 ? <Button disabled={isBusy} onClick={() => setActiveStep((step) => (step - 1) as 1 | 2)} variant="secondary">Back</Button> : <span />}
            <div className="event-editor__primary-actions">
              <Button disabled={isBusy} onClick={() => submitAction('save')} variant="secondary">
                {serverError ? 'Try saving again' : saveLabel}
              </Button>
              {activeStep < 3 ? (
                <Button disabled={isBusy} onClick={() => setActiveStep((step) => (step + 1) as 2 | 3)}>
                  {activeStep === 1 ? 'Continue to schedule' : 'Continue to review'}
                </Button>
              ) : <Button disabled={isBusy} onClick={() => submitAction('preview')}>Preview event</Button>}
            </div>
          </div>
        </form>
      </div>
      {blocker.state === 'blocked' ? (
        <div aria-labelledby="leave-draft-title" aria-modal="true" className="event-leave-dialog" role="alertdialog">
          <div className="event-leave-dialog__panel">
            <p className="organizer-eyebrow">Unsaved draft</p>
            <h2 id="leave-draft-title">Leave without saving?</h2>
            <p>Your latest changes will be lost.</p>
            <div><Button autoFocus onClick={() => blocker.reset()} variant="secondary">Stay</Button><Button onClick={() => { approvedNavigationRef.current = true; blocker.proceed() }}>Leave</Button></div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
