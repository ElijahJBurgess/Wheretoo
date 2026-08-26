import { supabase } from '../../lib/supabase/client'
import type { EventRow } from '../events/event.types'
import { ticketTiersInputSchema } from './ticket.schemas'
import type { TicketTierInput, TicketTierRow, TicketTiersInput } from './ticket.types'

type TierRpcRow = TicketTierRow

const usdInputPattern = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/

export function usdToMinor(value: string): number {
  const normalized = value.trim()
  if (!usdInputPattern.test(normalized)) {
    throw new Error('Enter a whole-dollar amount or up to two cents')
  }

  const [wholePart, centsPart = ''] = normalized.split('.')
  const minor = Number(wholePart) * 100 + Number(centsPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > 99_999_999) {
    throw new Error('Enter a whole-dollar amount or up to two cents')
  }
  return minor
}

function requireRows(data: TierRpcRow[] | null, eventId: string): TicketTierRow[] {
  if (data === null || data.some((tier) => tier.event_id !== eventId)) {
    throw new Error('Ticket tiers did not return a safe event response')
  }
  return data
}

function serializeTier(tier: TicketTierInput) {
  return {
    ...(tier.id === undefined ? {} : { id: tier.id }),
    name: tier.name,
    description: tier.description,
    unit_amount_minor: tier.unitAmountMinor,
    currency: tier.currency,
    quantity_total: tier.quantityTotal,
    sort_order: tier.sortOrder,
  }
}

export async function listOwnedTicketTiers(eventId: string): Promise<TicketTierRow[]> {
  const { data, error } = await supabase.rpc('list_owned_ticket_tiers', { p_event_id: eventId })
  if (error) throw error
  return requireRows(data, eventId)
}

export async function saveTicketTiers(eventId: string, values: TicketTiersInput): Promise<TicketTierRow[]> {
  const tiers = ticketTiersInputSchema.parse(values)
  const { data, error } = await supabase.rpc('save_ticket_tiers', {
    p_event_id: eventId,
    p_tiers: tiers.map(serializeTier),
  })
  if (error) throw error
  return requireRows(data, eventId)
}

export async function activatePaidSales(eventId: string): Promise<EventRow> {
  const { data, error } = await supabase.rpc('activate_paid_sales', { p_event_id: eventId })
  if (error) throw error
  if (data === null || data.id !== eventId || data.status !== 'published') {
    throw new Error('Paid sales activation did not return an event')
  }
  return data
}
