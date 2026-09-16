import { EventImageManager } from '../event-images/EventImageManager'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { useQueryClient } from '@tanstack/react-query'
import { adoptEventChangeCache } from '../event-changes/eventChanges.cache'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useBeforeUnload, useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ReadState } from '../../components/ui/ReadState'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { StepRail } from '../../components/ui/StepRail'
import { useSession } from '../auth/SessionProvider'
import { EventRequirementsStep, type OrganizerRequirementsFormValues } from '../moderation/EventRequirementsStep'
import { OrganizerAgreementStep } from '../moderation/OrganizerAgreementStep'
import {
  useRequiredEventPolicies,
} from '../moderation/moderation.queries'
import { useOwnedTicketTiers } from '../tickets/ticket.queries'
import { EventCompositionSummary } from './EventCompositionSummary'
import { EventCreationLayout } from './EventCreationLayout'
import { eventRowToFormValues } from './event.api'
import { EventDetailsStep } from './EventDetailsStep'
import { EventReviewStep } from './EventReviewStep'
import { EventScheduleLocationStep } from './EventScheduleLocationStep'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import { useSaveEventDraft } from './event.queries'
import { useEventChangeContext } from '../event-changes/eventChanges.queries'
import { acceptPoliciesIfCurrent, saveEventIfCurrent, saveRequirementsIfCurrent, EventChangeError, getEventChangeContext } from '../event-changes/eventChanges.api'
import type { EventChangeContext } from '../event-changes/eventChanges.schemas'
import { eventDraftSchema } from './event.schemas'
import { creationStepFromSearch, creationStepNames, draftResumeStep, stepIssues, type CreationEditorStep } from './eventWizard'
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
  agreementInvalidatedByEdit: false, hydratedEventId: '', minimumAge: '', alcoholPresent: false, cannabisPresent: false,
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
  const queryClient = useQueryClient()
  const routeIdentityKey = organizerId + ':' + eventId
  const routeIdentity = useMemo(() => ({ key: routeIdentityKey }), [routeIdentityKey])
  const latestRouteIdentityRef = useRef(routeIdentity)
  const mountedRef = useRef(false)
  useLayoutEffect(() => { latestRouteIdentityRef.current = routeIdentity }, [routeIdentity])
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const contextQuery = useEventChangeContext(eventId, organizerId)
  const [baseline, setBaseline] = useState<EventChangeContext | null>(null)
  const baselineRef = useRef<EventChangeContext | null>(null)
  const hasBaseline = baseline?.event_id === eventId && baseline.event.organizer_id === organizerId
  const context = hasBaseline ? baseline : contextQuery.isFetching || contextQuery.isError ? undefined : contextQuery.data
  const eventQuery = { ...contextQuery, isError: !hasBaseline && contextQuery.isError, data: context?.event }
  const requirementsQuery = { ...contextQuery, isError: !hasBaseline && contextQuery.isError, data: context?.requirements }
  const [writeState, setWriteState] = useState<'ready' | 'conflict' | 'unknown'>('ready')
  const [writing, setWriting] = useState(false)
  const [confirmReload, setConfirmReload] = useState(false)
  const policiesQuery = useRequiredEventPolicies()
  const saveDraftMutation = useSaveEventDraft()
  const explicitCreationStep = creationStepFromSearch(routeLocation.search)
  const creationSearch = new URLSearchParams(routeLocation.search)
  const isCreationFlow = isNew || explicitCreationStep !== null
    || creationSearch.get('resume') === '1' || creationSearch.get('saved') === '1'
  const initialStep = explicitCreationStep ?? 1
  const [activeStep, setActiveStep] = useState<ActiveStep>(initialStep)
  const [draftSaved, setDraftSaved] = useState(new URLSearchParams(routeLocation.search).get('saved') === '1')
  const [serverError, setServerError] = useState<string | null>(null)
  const [agreementError, setAgreementError] = useState<string | null>(null)
  const hydratedEventIdRef = useRef<string | null>(null)
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
    setError,
    clearErrors,
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
  const agreementInvalidatedByEdit = useWatch({ control: requirementsControl, name: 'agreementInvalidatedByEdit' }) ?? false
  const requirementsHydratedEventId = useWatch({ control: requirementsControl, name: 'hydratedEventId' })
  const eventQueryHasSafeIdentity = eventQuery.data === undefined || eventQuery.data === null || isNew
    || (eventQuery.data.id === eventId && eventQuery.data.organizer_id === organizerId)
  const ownedEvent = eventQueryHasSafeIdentity ? eventQuery.data : undefined
  const isPublished = ownedEvent?.status === 'published'
  const resumeTiersQuery = useOwnedTicketTiers(
    organizerId,
    isCreationFlow && ownedEvent?.admission_type === 'paid' && ownedEvent.status === 'draft' ? ownedEvent.id : '',
  )
  const waitingForResume = isCreationFlow && !isNew && ownedEvent?.status === 'draft' && explicitCreationStep === null
    && (requirementsQuery.isPending || (ownedEvent.admission_type === 'paid' && resumeTiersQuery.isPending))
  const requirementsAreHydrated = eventId !== '' && requirementsHydratedEventId === eventId
  const hasUnsavedChanges = isDirty || requirementsAreDirty
  const isBusy = isSubmitting || saveDraftMutation.isPending || writing || writeState !== 'ready'
  const currentNeedsAcceptance = requirementsQuery.data?.needsAcceptance !== false || agreementInvalidatedByEdit
  const organizerTerms = requirementsQuery.data ? requirementsQuery.data.organizerTerms : policiesQuery.data?.find((policy) => policy.policyKind === 'organizer_terms')
  const eventPolicy = requirementsQuery.data ? requirementsQuery.data.eventPolicy : policiesQuery.data?.find((policy) => policy.policyKind === 'event_policy')
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
    if (!waitingForResume && eventQuery.data && eventQueryHasSafeIdentity && hydratedEventIdRef.current !== eventQuery.data.id) {
      baselineRef.current = context ?? null
      setBaseline(context ?? null)
      reset(eventRowToFormValues(eventQuery.data))
      hydratedEventIdRef.current = eventQuery.data.id
      if (isCreationFlow && eventQuery.data.status === 'draft') {
        // The saved row and its tiers determine the first incomplete creation stage.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveStep(explicitCreationStep ?? draftResumeStep(
          eventRowToFormValues(eventQuery.data),
          resumeTiersQuery.data?.filter((tier) => tier.status !== 'archived').length ?? 0,
          requirementsQuery.data?.needsAcceptance === false,
        ))
      }
    }
  }, [context, eventQuery.data, eventQueryHasSafeIdentity, explicitCreationStep, isCreationFlow, requirementsQuery.data?.needsAcceptance, reset, resumeTiersQuery.data, waitingForResume])

  useEffect(() => {
    if (eventId !== '' && requirementsQuery.data && requirementsHydratedEventId !== eventId) {
      const requirements = requirementsQuery.data
      resetRequirements({
        agreementInvalidatedByEdit: false,
        hydratedEventId: eventId,
        minimumAge: requirements.minimumAge,
        alcoholPresent: requirements.alcoholPresent,
        cannabisPresent: requirements.cannabisPresent,
        explicitAdultContent: requirements.explicitAdultContent,
        gamblingPresent: requirements.gamblingPresent,
        weaponsPresent: requirements.weaponsPresent,
        highRiskActivity: requirements.highRiskActivity,
        organizerAgreement: !requirements.needsAcceptance,
      })
    }
  }, [eventId, requirementsHydratedEventId, requirementsQuery.data, resetRequirements])

  useEffect(() => {
    approvedNavigationRef.current = false
  }, [routeLocation.key])

  useEffect(() => {
    const requested = creationStepFromSearch(routeLocation.search)
    // Browser navigation can select a saved creation stage independently of button handlers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (requested !== null) setActiveStep(requested)
  }, [routeLocation.search])

  function setLocation(locationValue: NormalizedLocation | null) {
    setValue('location', locationValue, { shouldDirty: true, shouldValidate: true })
  }

  function navigateApproved(to: string, replace = false) {
    approvedNavigationRef.current = true
    void navigate(to, { replace })
  }

  function resetDisplayedAgreement() {
    setRequirementValue('agreementInvalidatedByEdit', true, { shouldDirty: false })
    setRequirementValue('organizerAgreement', false, { shouldDirty: false })
    setAgreementError(null)
  }

  function captureEditorIdentity() {
    const initiatingRouteIdentity = routeIdentity
    const accountIdentityIsCurrent = captureIdentityLifetime(queryClient, organizerId)
    return () => mountedRef.current && latestRouteIdentityRef.current === initiatingRouteIdentity && accountIdentityIsCurrent()
  }

  function adoptContext(next: EventChangeContext, isCurrent: () => boolean) {
    if (!isCurrent()) throw new EventChangeError('unknown')
    if (next.event_id !== eventId || next.event.organizer_id !== organizerId) throw new EventChangeError('unknown')
    adoptEventChangeCache(queryClient, next)
    baselineRef.current = next
    setBaseline(next)
  }

  function expectedContext() {
    const value = baselineRef.current
    if (writeState !== 'ready' || !value || value.event_id !== eventId || value.event.organizer_id !== organizerId) throw new EventChangeError('unknown')
    return value.context_token
  }

  function recordWriteFailure(error: unknown) {
    setWriteState(error instanceof EventChangeError && error.kind === 'conflict' ? 'conflict' : 'unknown')
  }

  async function reloadBaseline() {
    if (activeActionRef.current !== null || writing) return
    setWriting(true)
    try {
      const isCurrent = captureEditorIdentity()
      const next = await getEventChangeContext(eventId, organizerId)
      adoptContext(next, isCurrent)
      reset(eventRowToFormValues(next.event))
      resetRequirements({ ...next.requirements, agreementInvalidatedByEdit: false, hydratedEventId: eventId, organizerAgreement: !next.requirements.needsAcceptance })
      setWriteState('ready'); setServerError(null); setAgreementError(null); setConfirmReload(false)
    } catch { setServerError('The current saved event could not be loaded. Your inputs are still here.') }
    finally { setWriting(false) }
  }

  async function persistForCurrentLifecycle(valuesToSave: EventFormValues): Promise<EventRow> {
    if (!isNew) {
      // Even a no-op save validates the displayed baseline before later policy/publish actions.
      const isCurrent = captureEditorIdentity()
      const next = await saveEventIfCurrent(eventId, organizerId, expectedContext(), valuesToSave)
      adoptContext(next, isCurrent)
      reset(eventRowToFormValues(next.event))
      return next.event
    }
    const isCurrent = captureEditorIdentity()
    const saved = await saveDraftMutation.mutateAsync({ eventId: null, organizerId, values: valuesToSave })
    if (!isCurrent()) throw new EventChangeError('unknown')
    if (saved.organizer_id !== organizerId || !saved.id) throw new Error('SAVED_EVENT_IDENTITY_MISMATCH')
    reset(eventRowToFormValues(saved))
    return saved
  }

  async function persistRequirements() {
    const isCurrent = captureEditorIdentity()
      const next = await saveRequirementsIfCurrent(eventId, organizerId, expectedContext(), requirementsInput())
    adoptContext(next, isCurrent)
    return next.requirements
  }

  function requirementsInput() {
    const values = getRequirementValues()
    if (values.minimumAge === '') throw new Error('REQUIREMENTS_NOT_HYDRATED')
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
    if (activeActionRef.current !== null || writing) return
    activeActionRef.current = action
    setWriting(true)
    setServerError(null)

    const eventRevisionChanged = isDirty
    const requirementsChanged = requirementsAreDirty
    void handleSubmit(async (formValues) => {
      try {
        const saved = await persistForCurrentLifecycle(formValues)
        if (saved.id === eventId && ((action === 'save' && activeStep >= 4) || (requirementsAreHydrated && requirementsChanged))) {
          const savedRequirements = await persistRequirements()
          const agreementWasCurrent = requirementsQuery.data?.needsAcceptance === false
            && !eventRevisionChanged && !requirementsChanged && !agreementInvalidatedByEdit
          resetRequirements({
            ...savedRequirements,
            agreementInvalidatedByEdit: !agreementWasCurrent,
            hydratedEventId: eventId,
            organizerAgreement: agreementWasCurrent,
          })
        } else if (eventRevisionChanged) {
          resetDisplayedAgreement()
        }
        if (action === 'tickets') {
          navigateApproved(`/organizer/events/${saved.id}/tickets`)
        } else if (isNew) {
          setDraftSaved(true)
          navigateApproved(`/organizer/events/${saved.id}/edit?step=${creationStepNames[activeStep as CreationEditorStep]}&saved=1`, true)
        } else if (!isPublished && action === 'save') {
          setDraftSaved(true)
        }
      } catch (error) {
        if (!isNew) recordWriteFailure(error)
        setServerError(activeStep >= 4 && action === 'save'
          ? requirementsSaveError
          : isPublished ? revisionSaveError : draftSaveError)
      } finally {
        activeActionRef.current = null
        setWriting(false)
      }
    }, () => {
      activeActionRef.current = null
        setWriting(false)
      setServerError(null)
    })()
  }

  function continueDraftStep(step: 1 | 2) {
    if (activeActionRef.current !== null || writing) return
    clearErrors()
    const issues = stepIssues(getValues(), step)
    if (issues.length > 0) {
      for (const issue of issues) {
        setError(String(issue.path[0]) as keyof EventFormValues, { type: 'validate', message: issue.message })
      }
      return
    }
    activeActionRef.current = 'save'
    setWriting(true)
    setServerError(null)
    const revisionChanged = isDirty
    void handleSubmit(async (values) => {
      try {
        const saved = await persistForCurrentLifecycle(values)
        if (revisionChanged) resetDisplayedAgreement()
        const next = (step + 1) as CreationEditorStep
        setActiveStep(next)
        navigateApproved(`/organizer/events/${saved.id}/edit?step=${creationStepNames[next]}`, true)
      } catch (error) {
        if (!isNew) recordWriteFailure(error)
        setServerError(draftSaveError)
      } finally {
        activeActionRef.current = null
        setWriting(false)
      }
    }, () => {
      activeActionRef.current = null
      setWriting(false)
    })()
  }

  function goToDraftStep(step: CreationEditorStep) {
    clearErrors()
    setActiveStep(step)
    if (!hasUnsavedChanges && eventId !== '') {
      navigateApproved(`/organizer/events/${eventId}/edit?step=${creationStepNames[step]}`, true)
    }
  }

  function continueToRequirements() {
    if (activeActionRef.current !== null || writing) return
    activeActionRef.current = 'requirements'
    setWriting(true)
    setServerError(null)
    const revisionChanged = isDirty
    void handleSubmit(async (formValues) => {
      try {
        const saved = await persistForCurrentLifecycle(formValues)
        if (revisionChanged) resetDisplayedAgreement()
        if (isCreationFlow && (isNew || !isPublished)) navigateApproved(`/organizer/events/${saved.id}/edit?step=details`, true)
        setActiveStep(4)
      } catch (error) {
        if (!isNew) recordWriteFailure(error)
        setServerError(isPublished ? revisionSaveError : draftSaveError)
      } finally {
        activeActionRef.current = null
        setWriting(false)
      }
    }, () => {
      activeActionRef.current = null
        setWriting(false)
    })()
  }

  async function continueToAgreement() {
    if (activeActionRef.current !== null || eventId === '') return
    activeActionRef.current = 'requirements'
    setWriting(true)
    setServerError(null)
    try {
      const requirementsWereDirty = requirementsAreDirty
      const savedRequirements = await persistRequirements()
      const agreementWasCurrent = requirementsQuery.data?.needsAcceptance === false
        && !agreementInvalidatedByEdit && !requirementsWereDirty
      resetRequirements({
        ...savedRequirements,
        agreementInvalidatedByEdit: !agreementWasCurrent,
        hydratedEventId: eventId,
        organizerAgreement: agreementWasCurrent,
      })
      setActiveStep(5)
    } catch (error) {
      recordWriteFailure(error)
      setServerError(requirementsSaveError)
    } finally {
      activeActionRef.current = null
        setWriting(false)
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
    setWriting(true)
    setAgreementError(null)
    setServerError(null)

    void handleSubmit(async (formValues) => {
      try {
        await persistForCurrentLifecycle(formValues)
        const savedRequirements = await persistRequirements()
        const isCurrent = captureEditorIdentity()
        const acceptedContext = await acceptPoliciesIfCurrent(eventId, organizerId, expectedContext())
        adoptContext(acceptedContext, isCurrent)
        const accepted = acceptedContext.requirements
        if (accepted.needsAcceptance) {
          setAgreementError(agreementConfirmationError)
          return
        }
        resetRequirements({
          ...savedRequirements,
          agreementInvalidatedByEdit: false,
          hydratedEventId: eventId,
          organizerAgreement: true,
        })
        navigateApproved(`/organizer/events/${eventId}/preview`)
      } catch (error) {
        recordWriteFailure(error)
        setAgreementError(agreementConfirmationError)
      } finally {
        activeActionRef.current = null
        setWriting(false)
      }
    }, () => {
      activeActionRef.current = null
        setWriting(false)
    })()
  }

  if (
    sessionState.status !== 'authenticated' ||
    (!isNew && (eventQuery.isPending || eventQuery.data === undefined) && !eventQuery.isError)
  ) {
    return <ReadState headingAs="h1" paused={eventQuery.fetchStatus === 'paused'} status="loading" skeleton="detail-fields" title="Loading your event" />
  }
  if (contextQuery.isError && contextQuery.error instanceof EventChangeError && contextQuery.error.kind === 'not_found') {
    return <ReadState headingAs="h1" status="unavailable" title="Event unavailable" description="The event may no longer be available." action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>} />
  }
  if (!isNew && eventQuery.isError) {
    return <ReadState headingAs="h1" action={<Button onClick={() => void eventQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="unavailable" title="Your event could not load" />
  }
  if (!isNew && !eventQueryHasSafeIdentity) {
    return <ReadState headingAs="h1" action={<Button onClick={() => void eventQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="unavailable" title="Your event could not load" />
  }
  if (!isNew && eventQuery.data === null) {
    return <ReadState headingAs="h1" action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>} description="The event may no longer be available." status="unavailable" title="Event unavailable" />
  }
  if (!isNew && ownedEvent?.status !== 'draft' && ownedEvent?.status !== 'published') {
    return <ReadState headingAs="h1" action={<Link className="ui-button ui-button--secondary" to={`/organizer/events/${eventId}`}>View event</Link>} description="This event can no longer be edited." status="unavailable" title="Event editing unavailable" />
  }

  const validationMessages = Object.values(errors).flatMap((error) => error?.message ? [String(error.message)] : [])
  const requirementMessages = Object.values(requirementErrors).flatMap((error) => error?.message ? [String(error.message)] : [])
  const summaryErrors = [...validationMessages, ...requirementMessages]
  if (serverError) summaryErrors.push(serverError)
  if (agreementError) summaryErrors.push(agreementError)
  const saveLabel = isBusy ? 'Saving…' : isPublished ? 'Save changes' : 'Save draft'
  const requirementsNeedInitialState = activeStep >= 4 && !requirementsAreHydrated

  function requirementsInitialState() {
    if (!requirementsNeedInitialState) return null
    if (requirementsQuery.isError) {
      return (
        <ReadState
          action={<Button autoFocus onClick={() => void requirementsQuery.refetch()}>Try loading requirements again</Button>}
          description="Check your connection, then try again."
          status="unavailable"
          title="Event requirements could not load"
        />
      )
    }
    if (requirementsQuery.data === null) {
      return (
        <ReadState
          action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>}
          description="The event requirements may no longer be available."
          status="unavailable"
          title="Event requirements unavailable"
        />
      )
    }
    return <ReadState paused={requirementsQuery.fetchStatus === 'paused'} status="loading" title="Loading event requirements" />
  }

  if (waitingForResume) {
    return <ReadState headingAs="h1" status="loading" title="Loading your saved event" />
  }

  if (isCreationFlow && !isPublished) {
    const creationStage = activeStep >= 4 ? 5 : activeStep
    return (
      <EventCreationLayout
        admissionType={admissionType}
        onBack={activeStep > 1 ? () => { if (!isBusy) goToDraftStep((activeStep - 1) as CreationEditorStep) } : undefined}
        step={creationStage}
        title="Create Event"
      >
        {draftSaved ? (
          <div className="event-creation__state">
            <div aria-hidden="true" className="event-creation__symbol">✓</div>
            <h1>Draft saved</h1>
            <p>Your event has been saved as a draft. You can continue editing anytime.</p>
            <Button onClick={() => {
              setDraftSaved(false)
              if (eventId) navigateApproved(`/organizer/events/${eventId}/edit?step=${creationStepNames[activeStep as CreationEditorStep]}`, true)
            }}>Continue Editing</Button>
            <Link className="ui-button ui-button--secondary" to="/organizer/events">Go to My Events</Link>
          </div>
        ) : (
          <>
            <p aria-live="polite" className="event-creation__save">
              {writeState === 'conflict' ? 'Conflict' : writeState === 'unknown' ? 'Unknown' : hasUnsavedChanges || isNew ? 'Unsaved' : 'Saved'}
            </p>
            {writeState !== 'ready' ? <section role="alert"><h2>{writeState === 'conflict' ? 'This event changed elsewhere' : 'Save result unknown'}</h2><p>{writeState === 'conflict' ? 'Your displayed version is out of date.' : 'The response was lost or could not be verified. Do not assume this save failed or succeeded.'} Your inputs are preserved. Reload the saved version and review before continuing.</p><Button disabled={writing} onClick={() => setConfirmReload(true)} variant="secondary">Reload saved version</Button></section> : null}
            {confirmReload ? <section aria-label="Reload saved event"><p>Reloading replaces your current inputs with the server’s saved version. Review or copy your unsaved changes first.</p><Button disabled={writing} onClick={() => void reloadBaseline()}>Discard inputs and reload</Button><Button disabled={writing} onClick={() => setConfirmReload(false)} variant="secondary">Keep reviewing my inputs</Button></section> : null}
            <form noValidate onSubmit={(event) => event.preventDefault()}>
              <fieldset className="event-creation__form" disabled={isBusy}>
                <FormErrorSummary errors={summaryErrors} title={serverError || agreementError ? 'Changes were not saved' : 'Missing information'} />
                {activeStep === 1 ? <EventDetailsStep creation errors={errors} register={register} /> : null}
                {activeStep === 2 ? <EventScheduleLocationStep creation errors={errors} location={location} onLocationChange={setLocation} register={register} /> : null}
                {activeStep === 3 ? <div className="event-step">
                  <header className="event-step__header"><h1>Ticket Type</h1><p>How will people attend your event?</p></header>
                  <fieldset className="event-choice-group"><legend className="event-creation__sr">Admission</legend>
                    <label><input type="radio" value="paid" {...register('admissionType')} /><span><strong>Paid Tickets</strong><small>Sell tickets with card payments through Stripe.</small></span></label>
                    <label><input type="radio" value="free" {...register('admissionType')} /><span><strong>Free RSVP</strong><small>Let people attend for free.</small></span></label>
                  </fieldset>
                  {admissionType === 'free' ? <Field error={errors.capacity?.message} label="Capacity (optional)" name="capacity"><input min="1" inputMode="numeric" type="number" {...register('capacity', { setValueAs: (value) => value === '' || value == null ? null : Number(value) })} /></Field> : null}
                </div> : null}
                {requirementsInitialState()}
                {activeStep >= 4 && requirementsAreHydrated ? <>
                  <header className="event-step__header"><h1>Event Details</h1><p>Review your event and complete the final details.</p></header>
                  {ownedEvent ? <><EventCompositionSummary event={ownedEvent} /><EventImageManager key={eventId} eventId={eventId} disabled={isBusy} /></> : null}
                  <EventRequirementsStep control={requirementsControl} errors={requirementErrors} onRequirementChange={resetDisplayedAgreement} register={registerRequirement} />
                  {organizerTerms && eventPolicy ? <OrganizerAgreementStep error={requirementErrors.organizerAgreement?.message} eventPolicy={eventPolicy} needsAcceptance={currentNeedsAcceptance} onAgreementChange={() => { setAgreementError(null); requirementsForm.clearErrors('organizerAgreement') }} organizerTerms={organizerTerms} register={registerRequirement} /> : <ReadState status="unavailable" title="Publication policies are not available" description="You can save your draft and images. Agreement and publication will be available once Wheretoo has configured its policies." />}
                </> : null}
                <div className="event-editor__actions"><div className="event-editor__primary-actions">
                  {!requirementsNeedInitialState ? <Button disabled={isBusy} onClick={() => submitAction('save')} variant="secondary">{serverError ? 'Try saving again' : saveLabel}</Button> : null}
                  {activeStep === 1 || activeStep === 2 ? <Button disabled={isBusy} onClick={() => continueDraftStep(activeStep)}>Continue</Button> : null}
                  {activeStep === 3 ? <Button disabled={isBusy} onClick={() => admissionType === 'paid' ? submitAction('tickets') : continueToRequirements()}>Continue</Button> : null}
                  {activeStep >= 4 && requirementsAreHydrated ? <Button disabled={isBusy || !organizerTerms || !eventPolicy} onClick={submitAgreement}>{agreementError ? 'Try agreement again' : isBusy ? 'Saving…' : 'Continue'}</Button> : null}
                </div></div>
              </fieldset>
            </form>
          </>
        )}
        {blocker.state === 'blocked' ? <UnsavedChangesDialog onLeave={() => { approvedNavigationRef.current = true; blocker.proceed() }} onStay={() => blocker.reset()} /> : null}
      </EventCreationLayout>
    )
  }

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
            {writeState === 'conflict' ? 'Conflict' : writeState === 'unknown' ? 'Unknown' : hasUnsavedChanges || isNew ? 'Unsaved' : context?.currently_publicly_eligible ? 'Live' : 'Saved'}
          </p>
        </div>
      </header>
      {!isNew ? <Link to={`/organizer/events/${eventId}/changes`}>Review saved changes and notices</Link> : null}
      {writeState !== 'ready' ? <section role="alert"><h2>{writeState === 'conflict' ? 'This event changed elsewhere' : 'Save result unknown'}</h2><p>{writeState === 'conflict' ? 'Your displayed version is out of date.' : 'The response was lost or could not be verified. Do not assume this save failed or succeeded.'} Your inputs are preserved. Reload the saved version and review before continuing.</p><Button disabled={writing} onClick={() => setConfirmReload(true)} variant="secondary">Reload saved version</Button></section> : null}
      {confirmReload ? <section aria-label="Reload saved event"><p>Reloading replaces your current inputs with the server’s saved version. Review or copy your unsaved changes first.</p><Button disabled={writing} onClick={() => void reloadBaseline()}>Discard inputs and reload</Button><Button disabled={writing} onClick={() => setConfirmReload(false)} variant="secondary">Keep reviewing my inputs</Button></section> : null}
      <div className="event-editor__frame">
        <aside className="event-editor__rail"><StepRail current={activeStep} labels={steps} /></aside>
        <form className="event-editor__form" noValidate onSubmit={(event) => event.preventDefault()}>
          <FormErrorSummary errors={summaryErrors} title={serverError || agreementError ? 'Save needs review' : 'Check the highlighted fields'} />
          {activeStep === 1 ? <><EventDetailsStep errors={errors} register={register} />{eventId ? <EventImageManager key={eventId} eventId={eventId} disabled={isBusy} /> : null}</> : null}
          {activeStep === 2 ? <EventScheduleLocationStep errors={errors} location={location} onLocationChange={setLocation} register={register} /> : null}
          {activeStep === 3 ? <EventReviewStep eventId={isNew ? undefined : eventId} values={getValues()} /> : null}
          {requirementsInitialState()}
          {activeStep === 4 && requirementsAreHydrated ? (
            <EventRequirementsStep control={requirementsControl} errors={requirementErrors} onRequirementChange={resetDisplayedAgreement} register={registerRequirement} />
          ) : null}
          {activeStep === 5 && requirementsAreHydrated && organizerTerms && eventPolicy ? (
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
          {activeStep === 5 && requirementsAreHydrated && (!organizerTerms || !eventPolicy) ? (
            <ReadState status="unavailable" title="Publication policies are not available" description="You can save your draft and images. Agreement and publication will be available once Wheretoo has configured its policies." />
          ) : null}
          <div className="event-editor__actions">
            {activeStep > 1 ? <Button disabled={isBusy} onClick={() => setActiveStep((step) => (step - 1) as ActiveStep)} variant="secondary">Back</Button> : <span />}
            <div className="event-editor__primary-actions">
              {!requirementsNeedInitialState ? (
                <Button disabled={isBusy} onClick={() => submitAction('save')} variant="secondary">
                  {serverError ? 'Try saving again' : saveLabel}
                </Button>
              ) : null}
              {activeStep === 1 && admissionType === 'paid' ? (
                <Button disabled={isBusy} onClick={() => submitAction('tickets')}>Set up paid tickets</Button>
              ) : null}
              {activeStep === 1 ? <Button disabled={isBusy} onClick={() => setActiveStep(2)}>Continue to date &amp; location</Button> : null}
              {activeStep === 2 ? <Button disabled={isBusy} onClick={() => setActiveStep(3)}>Continue to tickets &amp; admission</Button> : null}
              {activeStep === 3 ? <Button disabled={isBusy} onClick={continueToRequirements}>Continue to event requirements</Button> : null}
              {activeStep === 4 && requirementsAreHydrated ? <Button disabled={isBusy || eventId === ''} onClick={() => void continueToAgreement()}>Continue to organizer agreement</Button> : null}
              {activeStep === 5 && requirementsAreHydrated ? (
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
