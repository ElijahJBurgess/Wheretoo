import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router-dom'
import { ReadState } from '../../components/ui/ReadState'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { useSession } from '../auth/SessionProvider'
import { UnsavedChangesDialog } from '../events/UnsavedChangesDialog'
import { EventCreationLayout } from '../events/EventCreationLayout'
import { eventRowToFormValues } from '../events/event.api'
import { useOwnedEvent, useSaveEventRevision } from '../events/event.queries'
import type { EventRow } from '../events/event.types'
import { useConnectStatus } from '../payments/payment.queries'
import { getPaidSalesErrorMessage } from './paidSalesErrors'
import { usdToMinor } from './ticket.api'
import { useOwnedTicketTiers, useSaveTicketTiers } from './ticket.queries'
import { ticketTiersInputSchema } from './ticket.schemas'
import type { TicketTierInput, TicketTierRow } from './ticket.types'

type EditableTier = {
  id?: string
  name: string
  description: string
  price: string
  quantityTotal: string
  sortOrder: number
}

type ActionIdentity = { eventId: string; organizerId: string; version: number }

class TierValidationError extends Error {
  constructor(message: string, readonly fieldErrors: Record<string, string>) {
    super(message)
  }
}

type TierDraft = {
  sourceKey: string
  tiers: EditableTier[]
  dirty: boolean
}

function minorToUsd(minor: number): string {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`
}

function rowToEditableTier(tier: TicketTierRow): EditableTier {
  return {
    id: tier.id,
    name: tier.name,
    description: tier.description ?? '',
    price: minorToUsd(tier.unit_amount_minor),
    quantityTotal: String(tier.quantity_total),
    sortOrder: tier.sort_order,
  }
}

function nextAvailableSlot(tiers: EditableTier[]): number | null {
  for (let slot = 1; slot <= 3; slot += 1) {
    if (!tiers.some((tier) => tier.sortOrder === slot)) return slot
  }
  return null
}

function newTier(sortOrder: number): EditableTier {
  return { name: '', description: '', price: '', quantityTotal: '', sortOrder, id: undefined }
}

function toPayload(tiers: EditableTier[]): TicketTierInput[] {
  const fieldErrors: Record<string, string> = {}
  const payload = tiers.map((tier, index) => {
    const name = tier.name.trim()
    if (name.length === 0) fieldErrors[`${index}-name`] = 'Enter a ticket tier name.'
    else if (name.length > 80) fieldErrors[`${index}-name`] = 'Ticket tier names can be at most 80 characters.'
    if (tier.description.trim().length > 240) fieldErrors[`${index}-description`] = 'Descriptions can be at most 240 characters.'
    const quantityTotal = Number(tier.quantityTotal)
    if (!Number.isSafeInteger(quantityTotal) || quantityTotal < 1 || quantityTotal > 2_147_483_647) {
      fieldErrors[`${index}-capacity`] = 'Enter a whole-number capacity for every ticket tier'
    }
    let unitAmountMinor = 0
    try {
      unitAmountMinor = usdToMinor(tier.price)
    } catch {
      fieldErrors[`${index}-price`] = 'Enter a whole-dollar amount or up to two cents'
    }
    return {
      ...(tier.id === undefined ? {} : { id: tier.id }),
      name,
      description: tier.description,
      unitAmountMinor,
      currency: 'usd',
      quantityTotal,
      sortOrder: tier.sortOrder,
    }
  })
  const normalizedNames = new Map<string, number>()
  payload.forEach((tier, index) => {
    const previous = normalizedNames.get(tier.name.toLocaleLowerCase('en-US'))
    if (previous !== undefined) {
      fieldErrors[`${previous}-name`] = 'Ticket tier names must be unique.'
      fieldErrors[`${index}-name`] = 'Ticket tier names must be unique.'
    }
    normalizedNames.set(tier.name.toLocaleLowerCase('en-US'), index)
  })
  if (Object.keys(fieldErrors).length > 0) {
    throw new TierValidationError('Check the highlighted ticket tiers.', fieldErrors)
  }
  const parsed = ticketTiersInputSchema.safeParse(payload)
  if (!parsed.success) {
    throw new TierValidationError('Check the highlighted ticket tiers.', {})
  }
  return parsed.data
}

function connectReady(status: ReturnType<typeof useConnectStatus>['data']): boolean {
  return status?.status === 'ready'
}

function publishedFreeConversionIsClosed(event: EventRow | null | undefined, now: number): boolean {
  if (event?.status !== 'published' || event.admission_type !== 'free') return false
  if (event.starts_at === null) return true
  const startsAt = Date.parse(event.starts_at)
  return !Number.isFinite(startsAt) || startsAt <= now
}

function publicTierTextChanged(tiers: EditableTier[], persisted: TicketTierRow[]): boolean {
  const editableText = tiers
    .map((tier) => ({ id: tier.id ?? null, name: tier.name.trim(), description: tier.description.trim(), sortOrder: tier.sortOrder }))
    .sort((left, right) => left.sortOrder - right.sortOrder)
  const persistedText = persisted
    .filter((tier) => tier.status !== 'archived')
    .map((tier) => ({ id: tier.id, name: tier.name, description: tier.description?.trim() ?? '', sortOrder: tier.sort_order }))
    .sort((left, right) => left.sortOrder - right.sortOrder)
  return JSON.stringify(editableText) !== JSON.stringify(persistedText)
}

export function OrganizerTicketTiersPage() {
  const { eventId = '' } = useParams()
  const navigate = useNavigate()
  const [pageOpenedAt] = useState(Date.now)
  const sessionState = useSession()
  const organizerId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const eventQuery = useOwnedEvent(eventId, organizerId)
  const ownedEventId = eventQuery.data?.id === eventId && eventQuery.data.organizer_id === organizerId ? eventQuery.data.id : ''
  const tiersQuery = useOwnedTicketTiers(organizerId, ownedEventId)
  const retainedTiers = tiersQuery.data?.filter((tier) => tier.status !== 'archived')
  const paidSalesAlreadyActive = eventQuery.data?.status === 'published'
    && eventQuery.data.admission_type === 'paid'
    && retainedTiers !== undefined
    && retainedTiers.length >= 1
    && retainedTiers.length <= 3
    && retainedTiers.every((tier) => tier.status === 'active')
  const freeConversionAlreadyStarted = publishedFreeConversionIsClosed(eventQuery.data, pageOpenedAt)
  const connectRequired = eventQuery.data?.status !== 'draft'
    && ownedEventId.length > 0
    && tiersQuery.data !== undefined
    && !paidSalesAlreadyActive
    && !freeConversionAlreadyStarted
  const connectQuery = useConnectStatus(connectRequired ? organizerId : '')
  const saveMutation = useSaveTicketTiers(organizerId, eventId)
  const saveRevisionMutation = useSaveEventRevision()
  const [draft, setDraft] = useState<TierDraft>({ sourceKey: '', tiers: [], dirty: false })
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [continueIdentity, setContinueIdentity] = useState<ActionIdentity | null>(null)
  const leaveApprovedRef = useRef(false)
  const mountedRef = useRef(false)
  const currentIdentityRef = useRef<ActionIdentity>({ eventId, organizerId, version: 0 })

  useLayoutEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useLayoutEffect(() => {
    const current = currentIdentityRef.current
    if (current.eventId === eventId && current.organizerId === organizerId) return
    currentIdentityRef.current = {
      eventId,
      organizerId,
      version: current.version + 1,
    }
  }, [eventId, organizerId])
  const sourceKey = useMemo(
    () => tiersQuery.data?.map((tier) => `${tier.id}:${tier.updated_at}`).join('|') ?? '',
    [tiersQuery.data],
  )

  const loadedTiers = useMemo(() => tiersQuery.data?.map(rowToEditableTier) ?? [], [tiersQuery.data])
  const tiers = !draft.dirty && draft.sourceKey !== sourceKey ? loadedTiers : draft.tiers
  const dirty = draft.dirty
  const isContinuing = continueIdentity?.eventId === eventId && continueIdentity.organizerId === organizerId

  function isCurrentIdentity(identity: ActionIdentity): boolean {
    return mountedRef.current && currentIdentityRef.current === identity
  }

  const shouldBlock = useCallback(() => dirty && !leaveApprovedRef.current, [dirty])
  const blocker = useBlocker(shouldBlock)
  useBeforeUnload(useCallback((browserEvent) => {
    if (dirty && !leaveApprovedRef.current) {
      browserEvent.preventDefault()
      browserEvent.returnValue = ''
    }
  }, [dirty]))

  function updateTier(index: number, patch: Partial<EditableTier>) {
    leaveApprovedRef.current = false
    setDraft({ sourceKey, tiers: tiers.map((tier, tierIndex) => tierIndex === index ? { ...tier, ...patch } : tier), dirty: true })
    setFormError(null)
    setFieldErrors({})
    setServerError(null)
  }

  function addTier() {
    leaveApprovedRef.current = false
    const slot = nextAvailableSlot(tiers)
    if (slot === null) return
    setDraft({ sourceKey, tiers: [...tiers, newTier(slot)], dirty: true })
  }

  function removeTier(index: number) {
    leaveApprovedRef.current = false
    if (tiers.length <= 1) return
    setDraft({ sourceKey, tiers: tiers.filter((_, tierIndex) => tierIndex !== index), dirty: true })
  }

  async function saveTiers(identity: ActionIdentity): Promise<boolean> {
    setFormError(null)
    setFieldErrors({})
    setServerError(null)
    if (publishedFreeConversionIsClosed(eventQuery.data, Date.now())) {
      setServerError('Paid conversion must be completed before the event starts.')
      return false
    }
    let payload: TicketTierInput[]
    try {
      payload = toPayload(tiers)
    } catch (error) {
      if (error instanceof TierValidationError) {
        setFormError(error.message)
        setFieldErrors(error.fieldErrors)
      } else {
        setFormError('Check each ticket tier and try again.')
      }
      return false
    }
    try {
      const saved = await saveMutation.mutateAsync(payload)
      if (!isCurrentIdentity(identity)) return false
      setDraft({
        sourceKey: saved.map((tier) => `${tier.id}:${tier.updated_at}`).join('|'),
        tiers: saved.map(rowToEditableTier),
        dirty: false,
      })
      return true
    } catch (error) {
      if (isCurrentIdentity(identity)) setServerError(getPaidSalesErrorMessage(error))
      return false
    }
  }

  async function continueToRequirements() {
    const identity = currentIdentityRef.current
    if (isContinuing || (connectRequired && !connectReady(connectQuery.data))) return
    setServerError(null)
    setFormError(null)
    if (publishedFreeConversionIsClosed(eventQuery.data, Date.now())) {
      setServerError('Paid conversion must be completed before the event starts.')
      return
    }
    setContinueIdentity(identity)
    try {
      if (!(await saveTiers(identity))) return
      if (!isCurrentIdentity(identity)) return
      if (eventQuery.data?.status === 'published' && eventQuery.data.admission_type === 'free') {
        const converted = await saveRevisionMutation.mutateAsync({
          eventId,
          organizerId,
          values: { ...eventRowToFormValues(eventQuery.data), admissionType: 'paid' },
        })
        if (!isCurrentIdentity(identity)) return
        if (converted.id !== eventId || converted.organizer_id !== organizerId || converted.admission_type !== 'paid') {
          throw new Error('Unexpected revision response')
        }
      }
      leaveApprovedRef.current = true
      void navigate(`/organizer/events/${eventId}/edit?step=${eventQuery.data?.status === 'draft' ? 'details' : 'requirements'}`)
    } catch (error) {
      if (isCurrentIdentity(identity)) setServerError(getPaidSalesErrorMessage(error))
    } finally {
      if (isCurrentIdentity(identity)) setContinueIdentity(null)
    }
  }

  if (sessionState.status !== 'authenticated' || ((eventQuery.isPending || eventQuery.data === undefined) && !eventQuery.isError)) {
    return <ReadState headingAs="h1" paused={eventQuery.fetchStatus === 'paused' || tiersQuery.fetchStatus === 'paused'} status="loading" skeleton="detail-fields" title="Loading ticket setup" />
  }
  if (eventQuery.isError) {
    return <ReadState headingAs="h1" action={<Button onClick={() => void eventQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="unavailable" title="Ticket setup could not load" />
  }
  const event = eventQuery.data
  if (event === null || event === undefined) {
    return <ReadState headingAs="h1" action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>} description="The event may no longer be available." status="unavailable" title="Event unavailable" />
  }
  if (event.admission_type !== 'paid' && !(event.status === 'published' && event.admission_type === 'free')) {
    return <ReadState headingAs="h1" action={<Link className="ui-button ui-button--secondary" to={`/organizer/events/${eventId}/edit`}>Edit event</Link>} description="Choose paid admission before setting up ticket tiers." status="unavailable" title="Ticket setup unavailable" />
  }
  if ((tiersQuery.isPending || tiersQuery.data === undefined) && !tiersQuery.isError) {
    return <ReadState headingAs="h1" paused={eventQuery.fetchStatus === 'paused' || tiersQuery.fetchStatus === 'paused'} status="loading" skeleton="detail-fields" title="Loading ticket setup" />
  }
  if (tiersQuery.isError && (typeof tiersQuery.error === 'object' && tiersQuery.error !== null && 'message' in tiersQuery.error && tiersQuery.error.message === 'EVENT_NOT_FOUND')) {
    return <ReadState headingAs="h1" action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>} description="The event may no longer be available." status="unavailable" title="Event unavailable" />
  }
  if (tiersQuery.isError) {
    return <ReadState headingAs="h1" action={<Button onClick={() => void tiersQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="unavailable" title="Ticket setup could not load" />
  }

  const eventNeedsPublicationFlow = event.status === 'draft'
    || event.admission_type === 'free'
    || (event.status === 'published' && event.admission_type === 'paid' && (
      publicTierTextChanged(tiers, tiersQuery.data ?? [])
      || event.moderated_revision !== event.content_revision
    ))
  const pending = saveMutation.isPending || isContinuing || saveRevisionMutation.isPending
  const errors = [formError, serverError].filter((message): message is string => message !== null)
  const connectSatisfied = !connectRequired || connectReady(connectQuery.data)

  const content = (
    <section aria-labelledby="ticket-tiers-title" className="ticket-tiers-page">
      <header className="ticket-tiers-page__header">
        <div>
          <p className="organizer-eyebrow">Paid event setup</p>
          <h1 id="ticket-tiers-title">Ticket tiers</h1>
          <p>Set the tickets guests can buy. Prices are shown in USD.</p>
          <Link to={`/organizer/events/${eventId}/waitlist`}>Waitlist</Link>
        </div>
        <p className={`event-save-state${dirty ? ' event-save-state--dirty' : ''}`} aria-live="polite">{dirty ? 'Unsaved' : 'Saved'}</p>
      </header>
      <FormErrorSummary errors={errors} title="Ticket setup needs attention" />
      <div className="ticket-tiers-page__grid">
        <form className="ticket-tiers-form" noValidate onSubmit={(event) => event.preventDefault()}>
          {tiers.map((tier, index) => (
            <fieldset disabled={pending} className="ticket-tier-card" key={tier.id ?? `new-${index}`}>
              <legend>Tier {index + 1}</legend>
              <div className="ticket-tier-card__header"><h2>{tier.name.trim() || `Ticket tier ${tier.sortOrder}`}</h2>{tiers.length > 1 ? <Button disabled={pending} onClick={() => removeTier(index)} variant="secondary">Remove tier {tier.name.trim() || tier.sortOrder}</Button> : null}</div>
              <div className="ticket-tier-card__fields">
                <Field error={fieldErrors[`${index}-name`]} label="Name" name={`tier-${index}-name`}><input maxLength={80} onChange={(event) => updateTier(index, { name: event.target.value })} value={tier.name} /></Field>
                <Field error={fieldErrors[`${index}-price`]} label={`Price for ${tier.name.trim() || `tier ${tier.sortOrder}`}`} name={`tier-${index}-price`}><input inputMode="decimal" onChange={(event) => updateTier(index, { price: event.target.value })} placeholder="19.99" value={tier.price} /></Field>
                <Field error={fieldErrors[`${index}-capacity`]} label="Capacity" name={`tier-${index}-capacity`}><input inputMode="numeric" min="1" onChange={(event) => updateTier(index, { quantityTotal: event.target.value })} type="number" value={tier.quantityTotal} /></Field>
                <Field error={fieldErrors[`${index}-description`]} label="Description (optional)" name={`tier-${index}-description`}><textarea maxLength={240} onChange={(event) => updateTier(index, { description: event.target.value })} value={tier.description} /></Field>
              </div>
            </fieldset>
          ))}
          <div className="ticket-tiers-form__actions">
            <Button disabled={pending || tiers.length >= 3} onClick={addTier} variant="secondary">Add ticket tier</Button>
            <Button disabled={pending || tiers.length < 1} onClick={() => void saveTiers(currentIdentityRef.current)}>{saveMutation.isPending ? 'Saving ticket tiers…' : 'Save ticket tiers'}</Button>
          </div>
        </form>
        <aside className="ticket-activation-panel" aria-labelledby="ticket-activation-title">
          <p className="organizer-eyebrow">Publication check</p>
          <h2 id="ticket-activation-title">Review event requirements</h2>
          {connectSatisfied
            ? <p>{event.status === 'published' && event.admission_type === 'free' ? 'Paid conversion must be completed before the event starts. Save these tiers, then confirm the current agreement and publish.' : eventNeedsPublicationFlow ? 'Save these tiers, confirm the current agreement, and publish this version.' : 'Paid sales remain active. Save price or capacity changes from the tier form.'}</p>
            : <p>Finish secure payment setup before continuing to event requirements.</p>}
          {connectRequired && !connectSatisfied ? <Link className="ui-button ui-button--secondary" to={`/organizer/settings/payments?eventId=${eventId}`}>Finish payment setup</Link> : null}
          {eventNeedsPublicationFlow ? (
            <Button disabled={pending || !connectSatisfied || tiers.length < 1} onClick={() => void continueToRequirements()}>
              {isContinuing ? 'Saving and continuing…' : event.status === 'draft' ? 'Continue' : 'Save and continue to event requirements'}
            </Button>
          ) : null}
        </aside>
      </div>
      {blocker.state === 'blocked' ? <UnsavedChangesDialog onLeave={() => { leaveApprovedRef.current = true; blocker.proceed() }} onStay={() => blocker.reset()} /> : null}
    </section>
  )
  return event.status === 'draft'
    ? <EventCreationLayout admissionType="paid" backTo={`/organizer/events/${eventId}/edit?step=ticket-type`} step={4} title="Create Event">{content}</EventCreationLayout>
    : content
}
