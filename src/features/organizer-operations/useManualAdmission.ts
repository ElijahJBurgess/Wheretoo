import { useEffect, useRef, useState } from 'react'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { getOrderDetails, redeemTicket } from './operations.api'
import { operationsKeys } from './operations.queries'
import type { ManualAdmissionResult } from './operations.schemas'
import { getFreeRegistration } from './freeOperations.api'
import { type AdmissionSelection, isFreeEventAdmissionOpen } from './freeOperations.schemas'
import { getOwnedEvent } from '../events/event.api'

type State = {
  phase: 'confirm' | 'submitting' | 'uncertain' | 'rechecking' | 'retry' | 'closed'
  result?: ManualAdmissionResult
}
// A dismissed or interrupted write remains uncertain across route/dialog remounts.
// Keep only scoped ticket IDs in memory; this never stores admission credentials.
const pendingByClient = new WeakMap<QueryClient, Set<string>>()
// Consumers key the mounted operation by owner/event/ticket. Nothing here issues credentials.
export function useManualAdmission(
  ownerId: string,
  identityVersion: number,
  selection: AdmissionSelection,
) {
  const client = useQueryClient()
  const { eventId, sourceId, sourceKind, ticketId } = selection
  const key = JSON.stringify([ownerId, identityVersion, eventId, sourceKind, sourceId, ticketId])
  let pending = pendingByClient.get(client)
  if (!pending) {
    pending = new Set()
    pendingByClient.set(client, pending)
  }
  const unresolved = pending
  const [state, setState] = useState<State>(() => ({
    phase: unresolved.has(key) ? 'uncertain' : 'confirm',
  }))
  const lifetime = useRef({
    active: false,
    busy: false,
    controller: null as AbortController | null,
  })
  useEffect(() => {
    const current = { active: true, busy: false, controller: null as AbortController | null }
    lifetime.current = current
    return () => {
      current.active = false
      current.controller?.abort()
    }
  }, [ownerId, identityVersion, eventId, sourceKind, sourceId, ticketId])

  async function run(recheck: boolean) {
    const current = lifetime.current
    if (!current.active || current.busy) return
    current.busy = true
    const controller = new AbortController()
    current.controller = controller
    unresolved.add(key)
    setState({ phase: recheck ? 'rechecking' : 'submitting' })
    // A timeout may follow a committed write; it never means the ticket was not used.
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      let next: State
      if (recheck) {
        if (sourceKind === 'free_registration') {
          const [registration, event] = await Promise.all([
            getFreeRegistration(eventId, sourceId, controller.signal),
            getOwnedEvent(eventId, ownerId),
          ])
          const ticket = registration.tickets.find(value => value.ticketId === ticketId)
          if (!event || event.id !== eventId || event.organizer_id !== ownerId || !ticket) {
            next = { phase: 'closed', result: { outcome: 'invalid' } }
          } else if (ticket.status === 'used' && ticket.usedAt) {
            next = { phase: 'closed', result: { outcome: 'already_used', buyerName: registration.registrantName, admissionLabel: ticket.admissionLabel, usedAt: ticket.usedAt } }
          } else if (ticket.status === 'cancelled' || registration.status === 'cancelled') {
            next = { phase: 'closed', result: { outcome: 'cancelled', buyerName: registration.registrantName, admissionLabel: ticket.admissionLabel } }
          } else {
            next = { phase: ticket.status === 'valid' && registration.status === 'confirmed' && isFreeEventAdmissionOpen(event) ? 'retry' : 'closed' }
          }
        } else {
          const order = await getOrderDetails(eventId, sourceId, controller.signal)
          const ticket = order.tickets.find((value) => value.id === ticketId)
          if (!ticket) next = { phase: 'closed', result: { outcome: 'invalid' } }
          else if (ticket.status === 'used' && ticket.usedAt) {
            next = { phase: 'closed', result: { outcome: 'already_used', buyerName: order.buyerName, admissionLabel: ticket.admissionLabel, usedAt: ticket.usedAt } }
          } else if (ticket.status === 'refunded' || ticket.status === 'cancelled') {
            next = { phase: 'closed', result: { outcome: ticket.status, buyerName: order.buyerName, admissionLabel: ticket.admissionLabel } }
          } else {
            next = { phase: ticket.status === 'valid' && order.admissionEligible ? 'retry' : 'closed' }
          }
        }
      } else {
        next = {
          phase: 'closed',
          result: await redeemTicket(eventId, ticketId, controller.signal),
        }
      }
      if (current.active && !controller.signal.aborted) {
        unresolved.delete(key)
        setState(next)
      } else if (current.active) setState({ phase: 'uncertain' })
    } catch {
      if (current.active) setState({ phase: 'uncertain' })
    } finally {
      clearTimeout(timeout)
      current.busy = false
      if (current.active) {
        void client.invalidateQueries({ queryKey: operationsKeys.event(ownerId, eventId) })
      }
    }
  }
  return {
    ...state,
    busy: state.phase === 'submitting' || state.phase === 'rechecking',
    submit: () => {
      if (state.phase === 'confirm' || state.phase === 'retry') void run(false)
    },
    recheck: () => {
      if (state.phase === 'uncertain') void run(true)
    },
  }
}
