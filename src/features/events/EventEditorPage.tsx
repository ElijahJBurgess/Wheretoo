import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useBeforeUnload, useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { StepRail } from '../../components/ui/StepRail'
import { useSession } from '../auth/SessionProvider'
import { EventRequirementsStep, type OrganizerRequirementsFormValues } from '../moderation/EventRequirementsStep'
import { OrganizerAgreementStep } from '../moderation/OrganizerAgreementStep'
import {
  useAcceptCurrentEventPolicies,
  useOwnedEventRequirements,
  useRequiredEventPolicies,
  useSaveEventRequirements,
} from '../moderation/moderation.queries'
import { eventRowToFormValues } from './event.api'
import { EventDetailsStep } from './EventDetailsStep'
import { EventReviewStep } from './EventReviewStep'
import { EventScheduleLocationStep } from './EventScheduleLocationStep'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import { useOwnedEvent, useSaveEventDraft, useSaveEventRevision } from './event.queries'
import { eventDraftSchema } from './event.schemas'
import type { EventFormValues, EventRow, NormalizedLocation } from './event.types'

type ActiveStep = 1 | 2 | 3 | 4 | 5

const steps = [
  'Basics',
  'Date/location',
  'Tickets/admission',
  'Event details/requirements',
  'Organizer agreement',
  'Preview',
  'Publish',
] as const

const emptyEvent: EventFormValues = {
  title: '', description: '', category: '', startsAt: '', endsAt: '',
  timezone: 'America/Los_Angeles', venueName: '', location: null,
  admissionType: 'free', capacity: null,
}

const emptyRequirements: OrganizerRequirementsFormValues = {
  minimumAge: 'all_ages', alcoholPresent: false, cannabisPresent: false,
  explicitAdultContent: false, gamblingPresent: false, weaponsPresent: false,
  highRiskActivity: false, organizerAgreement: false,
}

const draftSaveError = 'Draft could not be saved. Check your connection and try again.'
const revisionSaveError = 'Changes could not be saved. Check your connection and try again.'
const requirementsSaveError = 'Event requirements could not be saved. Check your connection and try again.'
const agreementConfirmationError = 'Your agreement could not be confirmed. Review it and try again.'

function moderationStatusLabel(status: EventRow['moderation_status']): string {
  if (status === 'under_review') return 'Under review'
  if (status === 'blocked') return 'Blocked'
  if (status === 'removed') return 'Removed'
  if (status === 'clear') return 'Clear'
  return 'Not evaluated'
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
  const requirementsQuery = useOwnedEventRequirements(organizerId, eventId)
  const policiesQuery = useRequiredEventPolicies()
  const saveDraftMutation = useSaveEventDraft()
  const saveRevisionMutation = useSaveEventRevision()
  const saveRequirementsMutation = useSaveEventRequirements(organizerId, eventId)
  const acceptPoliciesMutation = useAcceptCurrentEventPolicies(organizerId, eventId)
  const [activeStep, setActiveStep] = useState<ActiveStep>(1)
  const [serverError, setServerError] = useState<string | null>(null)
  const [agreementError, setAgreementError] = useState<string | null>(null)
  const [agreementInvalidatedByEdit, setAgreementInvalidatedByEdit] = useState(false)
  const [returnedEvent, setReturnedEvent] = useState<EventRow | null>(null)
  const hydratedEventIdRef = useRef<string | null>(null)
  const hydratedRequirementsEventIdRef = useRef<string | null>(null)
  const approvedNavigationRef = useRef(false)
  const activeActionRef = useRef<'save' | 'agreement' | 'requirements' | 'tickets' | null>(null)

  const eventForm = useForm<EventFormValues>({
    resolver: zodResolver(eventDraftSchema), defaultValues: emptyEvent, mode: 'onChange',
  })
  const requirementsForm = useForm<OrganizerRequirementsFormValues>({
    defaultValues: emptyRequirements, mode: 'onChange',
  })
  const {
    control,
    formState: { errors, isDirty, isSubmitting },
    getValues,
    handleSubmit,
    register,
    reset,
    setValue,
  } = eventForm
  const {
    control: requirementsControl,
    formState: { errors: requirementErrors, isDirty: requirementsAreDirty },
    getValues: getRequirementValues,
    register: registerRequirement,
    reset: resetRequirements,
    setError: setRequirementError,
    setValue: setRequirementValue,
  } = requirementsForm

  const location = useWatch({ control, name: 'location' })
  const title = useWatch({ control, name: 'title' })
  const admissionType = useWatch({ control, name: 'admissionType' })
  const ownedEvent = returnedEvent ?? eventQuery.data
  const isPublished = ownedEvent?.status === 'published'
  const hasUnsavedChanges = isDirty || requirementsAreDirty
  const isBusy = isSubmitting || saveDraftMutation.isPending || saveRevisionMutation.isPending
    || saveRequirementsMutation.isPending || acceptPoliciesMutation.isPending
  const currentNeedsAcceptance = requirementsQuery.data?.needsAcceptance !== false || agreementInvalidatedByEdit
  const organizerTerms = requirementsQuery.data?.organizerTerms
    ?? policiesQuery.data?.find((policy) => policy.policyKind === 'organizer_terms')
  const eventPolicy = requirementsQuery.data?.eventPolicy
    ?? policiesQuery.data?.find((policy) => policy.policyKind === 'event_policy')
  const shouldBlockNavigation = useCallback(
    () => hasUnsavedChanges && !approvedNavigationRef.current,
    [hasUnsavedChanges],
  )
  const blocker = useBlocker(shouldBlockNavigation)

  useBeforeUnload(useCallback((event) => {
    if (hasUnsavedChanges && !approvedNavigationRef.current) {
      event.preventDefault()
      event.returnValue = ''
    }
  }, [hasUnsavedChanges]))

  useEffect(() => {
    if (eventQuery.data && hydratedEventIdRef.current !== eventQuery.data.id) {
      reset(eventRowToFormValues(eventQuery.data))
      hydratedEventIdRef.current = eventQuery.data.id
      setReturnedEvent(null)
    }
  }, [eventQuery.data, reset])

  useEffect(() => {
    if (requirementsQuery.data && hydratedRequirementsEventIdRef.current !== eventId) {
      const requirements = requirementsQuery.data
      resetRequirements({
        minimumAge: requirements.minimumAge,
        alcoholPresent: requirements.alcoholPresent,
        cannabisPresent: requirements.cannabisPresent,
        explicitAdultContent: requirements.explicitAdultContent,
        gamblingPresent: requirements.gamblingPresent,
        weaponsPresent: requirements.weaponsPresent,
        highRiskActivity: requirements.highRiskActivity,
        organizerAgreement: !requirements.needsAcceptance,
      })
      hydratedRequirementsEventIdRef.current = eventId
      setAgreementInvalidatedByEdit(false)
    }
  }, [eventId, requirementsQuery.data, resetRequirements])

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

  function resetDisplayedAgreement() {
    setAgreementInvalidatedByEdit(true)
    setRequirementValue('organizerAgreement', false, { shouldDirty: true })
    setAgreementError(null)
  }

  async function persistForCurrentLifecycle(valuesToSave: EventFormValues): Promise<EventRow> {
    if (!isNew && !isDirty && ownedEvent) return ownedEvent
    if (isPublished) {
      const saved = await saveRevisionMutation.mutateAsync({ eventId, organizerId, values: valuesToSave })
      if (saved.id !== eventId || saved.organizer_id !== organizerId) throw new Error('SAVED_EVENT_IDENTITY_MISMATCH')
      reset(eventRowToFormValues(saved))
      hydratedEventIdRef.current = saved.id
      setReturnedEvent(saved)
      return saved
    }
    const saved = await saveDraftMutation.mutateAsync({ eventId: isNew ? null : eventId, organizerId, values: valuesToSave })
    if (saved.organizer_id !== organizerId || (!isNew && saved.id !== eventId) || saved.id.length === 0) {
      throw new Error('SAVED_EVENT_IDENTITY_MISMATCH')
    }
    reset(eventRowToFormValues(saved))
    hydratedEventIdRef.current = saved.id
    setReturnedEvent(saved)
    return saved
  }

  function requirementsInput() {
    const values = getRequirementValues()
    return {
      minimumAge: values.minimumAge,
      alcoholPresent: values.alcoholPresent,
      cannabisPresent: values.cannabisPresent,
      explicitAdultContent: values.explicitAdultContent,
      gamblingPresent: values.gamblingPresent,
      weaponsPresent: values.weaponsPresent,
      highRiskActivity: values.highRiskActivity,
    }
  }

  const submitAction = (action: 'save' | 'tickets') => {
    if (activeActionRef.current !== null) return
    activeActionRef.current = action
    setServerError(null)

    const eventRevisionChanged = isDirty
    const requirementsChanged = requirementsAreDirty
    void handleSubmit(async (formValues) => {
      try {
        const saved = await persistForCurrentLifecycle(formValues)
        if (action === 'save' && activeStep >= 4 && saved.id === eventId) {
          const savedRequirements = await saveRequirementsMutation.mutateAsync(requirementsInput())
          const agreementWasCurrent = requirementsQuery.data?.needsAcceptance === false
            && !eventRevisionChanged && !requirementsChanged && !agreementInvalidatedByEdit
          resetRequirements({ ...savedRequirements, organizerAgreement: agreementWasCurrent })
          setAgreementInvalidatedByEdit(!agreementWasCurrent)
        } else if (eventRevisionChanged) {
          resetDisplayedAgreement()
        }
        if (action === 'tickets') {
          navigateApproved(`/organizer/events/${saved.id}/tickets`)
        } else if (isNew) {
          navigateApproved(`/organizer/events/${saved.id}/edit`, true)
        }
      } catch {
        setServerError(activeStep >= 4 && action === 'save'
          ? requirementsSaveError
          : isPublished ? revisionSaveError : draftSaveError)
      } finally {
        activeActionRef.current = null
      }
    }, () => {
      activeActionRef.current = null
      setServerError(null)
    })()
  }

  function continueToRequirements() {
    if (activeActionRef.current !== null) return
    activeActionRef.current = 'requirements'
    setServerError(null)
    const revisionChanged = isDirty
    void handleSubmit(async (formValues) => {
      try {
        const saved = await persistForCurrentLifecycle(formValues)
        if (revisionChanged) resetDisplayedAgreement()
        if (isNew) navigateApproved(`/organizer/events/${saved.id}/edit`, true)
        setActiveStep(4)
      } catch {
        setServerError(isPublished ? revisionSaveError : draftSaveError)
      } finally {
        activeActionRef.current = null
      }
    }, () => {
      activeActionRef.current = null
    })()
  }

  async function continueToAgreement() {
    if (activeActionRef.current !== null || eventId === '') return
    activeActionRef.current = 'requirements'
    setServerError(null)
    try {
      const requirementsWereDirty = requirementsAreDirty
      const savedRequirements = await saveRequirementsMutation.mutateAsync(requirementsInput())
      const agreementWasCurrent = requirementsQuery.data?.needsAcceptance === false
        && !agreementInvalidatedByEdit && !requirementsWereDirty
      resetRequirements({ ...savedRequirements, organizerAgreement: agreementWasCurrent })
      setAgreementInvalidatedByEdit(!agreementWasCurrent)
      setActiveStep(5)
    } catch {
      setServerError(requirementsSaveError)
    } finally {
      activeActionRef.current = null
    }
  }

  function submitAgreement() {
    if (activeActionRef.current !== null || eventId === '') return
    const agreementChecked = getRequirementValues('organizerAgreement')
    if (!agreementChecked) {
      setRequirementError('organizerAgreement', {
        type: 'required', message: 'Confirm the organizer agreement before previewing.',
      })
      return
    }
    activeActionRef.current = 'agreement'
    setAgreementError(null)
    setServerError(null)

    void handleSubmit(async (formValues) => {
      try {
        await persistForCurrentLifecycle(formValues)
        const savedRequirements = await saveRequirementsMutation.mutateAsync(requirementsInput())
        const accepted = await acceptPoliciesMutation.mutateAsync()
        if (accepted.needsAcceptance) {
          setAgreementError(agreementConfirmationError)
          return
        }
        resetRequirements({ ...savedRequirements, organizerAgreement: true })
        setAgreementInvalidatedByEdit(false)
        navigateApproved(`/organizer/events/${eventId}/preview`)
      } catch {
        setAgreementError(agreementConfirmationError)
      } finally {
        activeActionRef.current = null
      }
    }, () => {
      activeActionRef.current = null
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
  if (!isNew && ownedEvent?.status !== 'draft' && ownedEvent?.status !== 'published') {
    return <AsyncState action={<Link className="ui-button ui-button--secondary" to={`/organizer/events/${eventId}`}>View event</Link>} description="This event can no longer be edited." status="empty" title="Event editing unavailable" />
  }

  const validationMessages = Object.values(errors).flatMap((error) => error?.message ? [String(error.message)] : [])
  const requirementMessages = Object.values(requirementErrors).flatMap((error) => error?.message ? [String(error.message)] : [])
  const summaryErrors = [...validationMessages, ...requirementMessages]
  if (serverError) summaryErrors.push(serverError)
  if (agreementError) summaryErrors.push(agreementError)
  const saveLabel = isBusy ? 'Saving…' : isPublished ? 'Save changes' : 'Save draft'

  return (
    <section aria-labelledby="event-editor-title" className="event-editor">
      <header className="event-editor__masthead">
        <div>
          <p className="organizer-eyebrow">{isNew ? 'New event' : isPublished ? 'Published event' : 'Event draft'}</p>
          <h1 id="event-editor-title">{title.trim() || 'Untitled event'}</h1>
        </div>
        <div className="event-editor__states">
          {isPublished && ownedEvent ? <p className={`moderation-state moderation-state--${ownedEvent.moderation_status}`}>{moderationStatusLabel(ownedEvent.moderation_status)}</p> : null}
          <p className={`event-save-state${hasUnsavedChanges ? ' event-save-state--dirty' : ''}`} aria-live="polite">
            {hasUnsavedChanges || isNew ? 'Unsaved' : 'Saved'}
          </p>
        </div>
      </header>
      <div className="event-editor__frame">
        <aside className="event-editor__rail"><StepRail current={activeStep} labels={steps} /></aside>
        <form className="event-editor__form" noValidate onSubmit={(event) => event.preventDefault()}>
          <FormErrorSummary errors={summaryErrors} title={serverError || agreementError ? 'Changes were not saved' : 'Check the highlighted fields'} />
          {activeStep === 1 ? <EventDetailsStep errors={errors} register={register} /> : null}
          {activeStep === 2 ? <EventScheduleLocationStep errors={errors} location={location} onLocationChange={setLocation} register={register} /> : null}
          {activeStep === 3 ? <EventReviewStep eventId={isNew ? undefined : eventId} values={getValues()} /> : null}
          {activeStep === 4 ? (
            <EventRequirementsStep control={requirementsControl} errors={requirementErrors} onRequirementChange={resetDisplayedAgreement} register={registerRequirement} />
          ) : null}
          {activeStep === 5 && organizerTerms && eventPolicy ? (
            <OrganizerAgreementStep
              error={requirementErrors.organizerAgreement?.message}
              eventPolicy={eventPolicy}
              needsAcceptance={currentNeedsAcceptance}
              onAgreementChange={() => {
                setAgreementError(null)
                requirementsForm.clearErrors('organizerAgreement')
              }}
              organizerTerms={organizerTerms}
              register={registerRequirement}
            />
          ) : null}
          {activeStep === 5 && (!organizerTerms || !eventPolicy) ? (
            <AsyncState status="error" title="Current policies could not load" description="Check your connection, then try again." />
          ) : null}
          <div className="event-editor__actions">
            {activeStep > 1 ? <Button disabled={isBusy} onClick={() => setActiveStep((step) => (step - 1) as ActiveStep)} variant="secondary">Back</Button> : <span />}
            <div className="event-editor__primary-actions">
              <Button disabled={isBusy} onClick={() => submitAction('save')} variant="secondary">
                {serverError ? 'Try saving again' : saveLabel}
              </Button>
              {activeStep === 1 && admissionType === 'paid' ? (
                <Button disabled={isBusy} onClick={() => submitAction('tickets')}>Set up paid tickets</Button>
              ) : null}
              {activeStep === 1 ? <Button disabled={isBusy} onClick={() => setActiveStep(2)}>Continue to date &amp; location</Button> : null}
              {activeStep === 2 ? <Button disabled={isBusy} onClick={() => setActiveStep(3)}>Continue to tickets &amp; admission</Button> : null}
              {activeStep === 3 ? <Button disabled={isBusy} onClick={continueToRequirements}>Continue to event requirements</Button> : null}
              {activeStep === 4 ? <Button disabled={isBusy || eventId === ''} onClick={() => void continueToAgreement()}>Continue to organizer agreement</Button> : null}
              {activeStep === 5 ? (
                <Button disabled={isBusy || !organizerTerms || !eventPolicy} onClick={submitAgreement}>
                  {agreementError ? 'Try agreement again' : isBusy ? 'Saving agreement…' : 'Save agreement and preview'}
                </Button>
              ) : null}
            </div>
          </div>
        </form>
      </div>
      {blocker.state === 'blocked' ? (
        <UnsavedChangesDialog
          onLeave={() => {
            approvedNavigationRef.current = true
            blocker.proceed()
          }}
          onStay={() => blocker.reset()}
        />
      ) : null}
    </section>
  )
}
