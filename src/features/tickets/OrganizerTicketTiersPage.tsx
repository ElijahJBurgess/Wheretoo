import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { useSession } from '../auth/SessionProvider'
import { UnsavedChangesDialog } from '../events/UnsavedChangesDialog'
import { useOwnedEvent } from '../events/event.queries'
import { useConnectStatus } from '../payments/payment.queries'
import { getPaidSalesErrorMessage } from './paidSalesErrors'
import { usdToMinor } from './ticket.api'
import { useActivatePaidSales, useOwnedTicketTiers, useSaveTicketTiers } from './ticket.queries'
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

export function OrganizerTicketTiersPage() {
  const { eventId = '' } = useParams()
  const navigate = useNavigate()
  const sessionState = useSession()
  const organizerId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const eventQuery = useOwnedEvent(eventId, organizerId)
  const ownedEventId = eventQuery.data?.organizer_id === organizerId ? eventQuery.data.id : ''
  const tiersQuery = useOwnedTicketTiers(organizerId, ownedEventId)
  const connectQuery = useConnectStatus(organizerId)
  const saveMutation = useSaveTicketTiers(organizerId, eventId)
  const activateMutation = useActivatePaidSales(organizerId)
  const [draft, setDraft] = useState<TierDraft>({ sourceKey: '', tiers: [], dirty: false })
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [activationIdentity, setActivationIdentity] = useState<ActionIdentity | null>(null)
  const [leaveApproved, setLeaveApproved] = useState(false)
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
  const isActivating = activationIdentity?.eventId === eventId && activationIdentity.organizerId === organizerId

  function isCurrentIdentity(identity: ActionIdentity): boolean {
    return mountedRef.current && currentIdentityRef.current === identity
  }

  const shouldBlock = useCallback(() => dirty && !leaveApproved, [dirty, leaveApproved])
  const blocker = useBlocker(shouldBlock)
  useBeforeUnload(useCallback((browserEvent) => {
    if (dirty && !leaveApproved) {
      browserEvent.preventDefault()
      browserEvent.returnValue = ''
    }
  }, [dirty, leaveApproved]))

  function updateTier(index: number, patch: Partial<EditableTier>) {
    setDraft({ sourceKey, tiers: tiers.map((tier, tierIndex) => tierIndex === index ? { ...tier, ...patch } : tier), dirty: true })
    setFormError(null)
    setFieldErrors({})
    setServerError(null)
  }

  function addTier() {
    const slot = nextAvailableSlot(tiers)
    if (slot === null) return
    setDraft({ sourceKey, tiers: [...tiers, newTier(slot)], dirty: true })
  }

  function removeTier(index: number) {
    if (tiers.length <= 1) return
    setDraft({ sourceKey, tiers: tiers.filter((_, tierIndex) => tierIndex !== index), dirty: true })
  }

  async function saveTiers(identity: ActionIdentity): Promise<boolean> {
    setFormError(null)
    setFieldErrors({})
    setServerError(null)
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

  async function activateSales() {
    const identity = currentIdentityRef.current
    if (isActivating || !connectReady(connectQuery.data)) return
    setServerError(null)
    setFormError(null)
    setActivationIdentity(identity)
    try {
      if (dirty && !(await saveTiers(identity))) return
      if (!isCurrentIdentity(identity)) return
      const activated = await activateMutation.mutateAsync(eventId)
      if (!isCurrentIdentity(identity)) return
      if (activated.id !== eventId || activated.organizer_id !== organizerId || activated.status !== 'published') {
        throw new Error('Unexpected activation response')
      }
      setLeaveApproved(true)
      void navigate(`/organizer/events/${eventId}`)
    } catch (error) {
      if (isCurrentIdentity(identity)) setServerError(getPaidSalesErrorMessage(error))
    } finally {
      if (isCurrentIdentity(identity)) setActivationIdentity(null)
    }
  }

  if (sessionState.status !== 'authenticated' || ((eventQuery.isPending || eventQuery.data === undefined) && !eventQuery.isError)) {
    return <AsyncState status="loading" title="Loading ticket setup" />
  }
  if (eventQuery.isError) {
    return <AsyncState action={<Button onClick={() => void eventQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="error" title="Ticket setup could not load" />
  }
  const event = eventQuery.data
  if (event === null || event === undefined) {
    return <AsyncState action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>} description="The event may no longer be available." status="empty" title="Event not found" />
  }
  if (event.admission_type !== 'paid' && !(event.status === 'published' && event.admission_type === 'free')) {
    return <AsyncState action={<Link className="ui-button ui-button--secondary" to={`/organizer/events/${eventId}/edit`}>Edit event</Link>} description="Choose paid admission before setting up ticket tiers." status="empty" title="Ticket setup unavailable" />
  }
  if ((tiersQuery.isPending || tiersQuery.data === undefined) && !tiersQuery.isError) {
    return <AsyncState status="loading" title="Loading ticket setup" />
  }
  if (tiersQuery.isError && (typeof tiersQuery.error === 'object' && tiersQuery.error !== null && 'message' in tiersQuery.error && tiersQuery.error.message === 'EVENT_NOT_FOUND')) {
    return <AsyncState action={<Link className="ui-button ui-button--secondary" to="/organizer/events">Back to events</Link>} description="The event may no longer be available." status="empty" title="Event not found" />
  }
  if (tiersQuery.isError) {
    return <AsyncState action={<Button onClick={() => void tiersQuery.refetch()}>Try again</Button>} description="Check your connection, then try again." status="error" title="Ticket setup could not load" />
  }

  const pending = saveMutation.isPending || isActivating || activateMutation.isPending
  const errors = [formError, serverError].filter((message): message is string => message !== null)
  const ready = connectReady(connectQuery.data)

  return (
    <section aria-labelledby="ticket-tiers-title" className="ticket-tiers-page">
      <header className="ticket-tiers-page__header">
        <div>
          <p className="organizer-eyebrow">Paid event setup</p>
          <h1 id="ticket-tiers-title">Ticket tiers</h1>
          <p>Set the tickets guests can buy. Prices are shown in USD.</p>
        </div>
        <p className={`event-save-state${dirty ? ' event-save-state--dirty' : ''}`} aria-live="polite">{dirty ? 'Unsaved' : 'Saved'}</p>
      </header>
      <FormErrorSummary errors={errors} title="Ticket setup needs attention" />
      <div className="ticket-tiers-page__grid">
        <form className="ticket-tiers-form" noValidate onSubmit={(event) => event.preventDefault()}>
          {tiers.map((tier, index) => (
            <fieldset className="ticket-tier-card" key={tier.id ?? `new-${index}`}>
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
          <p className="organizer-eyebrow">Ready to sell</p>
          <h2 id="ticket-activation-title">Activate paid sales</h2>
          {ready ? <p>Ticket sales will be available as soon as this eligible event is activated.</p> : <p>Finish secure payment setup before guests can buy tickets.</p>}
          {!ready ? <Link className="ui-button ui-button--secondary" to="/organizer/settings/payments">Finish payment setup</Link> : null}
          <Button disabled={pending || !ready || tiers.length < 1} onClick={() => void activateSales()}>{isActivating ? 'Activating paid sales…' : 'Activate paid sales'}</Button>
        </aside>
      </div>
      {blocker.state === 'blocked' ? <UnsavedChangesDialog onLeave={() => { setLeaveApproved(true); blocker.proceed() }} onStay={() => blocker.reset()} /> : null}
    </section>
  )
}
