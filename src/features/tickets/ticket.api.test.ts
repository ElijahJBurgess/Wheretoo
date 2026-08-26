import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../lib/supabase/client', () => ({ supabase: { rpc } }))

import { activatePaidSales, listOwnedTicketTiers, saveTicketTiers, usdToMinor } from './ticket.api'

const eventId = 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f'
const tier = {
  id: '900a9142-9111-4f87-84d5-b8545a94c7fb', event_id: eventId, name: 'General admission',
  description: null, unit_amount_minor: 2_500, currency: 'usd', quantity_total: 80, sort_order: 1,
  status: 'draft', version: 1, created_at: '2026-08-25T12:00:00.000Z', updated_at: '2026-08-25T12:00:00.000Z',
}

describe('owned ticket tier API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses only the owner-safe tier RPC and returns its active rows', async () => {
    rpc.mockResolvedValue({ data: [tier], error: null })

    await expect(listOwnedTicketTiers(eventId)).resolves.toEqual([tier])
    expect(rpc).toHaveBeenCalledWith('list_owned_ticket_tiers', { p_event_id: eventId })
  })

  it('serializes exact integer minor units and never browser dollar amounts', async () => {
    rpc.mockResolvedValue({ data: [tier], error: null })

    await saveTicketTiers(eventId, [{
      id: tier.id, name: tier.name, description: null, unitAmountMinor: 2_500, currency: 'usd', quantityTotal: 80, sortOrder: 1,
    }])

    expect(rpc).toHaveBeenCalledWith('save_ticket_tiers', {
      p_event_id: eventId,
      p_tiers: [{
        id: tier.id, name: tier.name, description: null, unit_amount_minor: 2_500, currency: 'usd', quantity_total: 80, sort_order: 1,
      }],
    })
  })

  it('uses the activation RPC and rejects an unsafe response', async () => {
    rpc.mockResolvedValueOnce({ data: { id: eventId, organizer_id: 'organizer-1', status: 'published', published_at: '2026-08-25T12:00:00.000Z' }, error: null })
    await expect(activatePaidSales(eventId)).resolves.toMatchObject({ id: eventId, status: 'published' })
    expect(rpc).toHaveBeenCalledWith('activate_paid_sales', { p_event_id: eventId })

    rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(activatePaidSales(eventId)).rejects.toThrow('Paid sales activation did not return an event')
  })
})

describe('usdToMinor', () => {
  it.each([
    ['19.99', 1_999],
    ['0.01', 1],
    ['999999.99', 99_999_999],
  ])('converts the exact decimal %s without binary floating drift', (usd, minor) => {
    expect(usdToMinor(usd)).toBe(minor)
  })

  it.each(['1.999', '1e2', '-1.00', '0.00', '1000000.00'])('rejects unsafe USD input %s', (usd) => {
    expect(() => usdToMinor(usd)).toThrow('Enter a whole-dollar amount or up to two cents')
  })
})
