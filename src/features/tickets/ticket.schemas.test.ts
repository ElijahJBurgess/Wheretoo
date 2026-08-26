import { describe, expect, it } from 'vitest'
import type { Database } from '../../lib/supabase/database.types'
import { ticketTiersInputSchema } from './ticket.schemas'

const validTier = {
  name: 'General admission',
  description: 'Entry to the market.',
  unitAmountMinor: 2_500,
  currency: 'usd',
  quantityTotal: 120,
  sortOrder: 1,
}

describe('ticketTiersInputSchema', () => {
  it('includes the current ticketing tables and RPCs in generated Supabase types', () => {
    assertGeneratedDatabaseSurface<
      HasAll<
        | 'organizer_stripe_accounts'
        | 'platform_fee_rules'
        | 'ticket_tiers'
        | 'stripe_webhook_events'
        | 'orders'
        | 'order_items'
        | 'tickets'
        | 'refunds'
        | 'disputes',
        keyof Database['public']['Tables']
      >
    >(true)
    assertGeneratedDatabaseSurface<
      HasAll<
        | 'list_owned_ticket_tiers'
        | 'save_ticket_tiers'
        | 'activate_paid_sales'
        | 'get_public_event_ticketing'
        | 'server_reserve_checkout'
        | 'server_attach_checkout_session'
        | 'server_cancel_checkout_reservation'
        | 'server_expire_checkout_reservations'
        | 'server_record_webhook_receipt'
        | 'server_fulfill_paid_order'
        | 'server_mark_payment_processing'
        | 'server_mark_payment_failed'
        | 'server_apply_refund'
        | 'server_apply_dispute',
        keyof Database['public']['Functions']
      >
    >(true)

    expect(true).toBe(true)
  })

  it('accepts one to three unique tiers and normalizes their trimmed text', () => {
    expect(
      ticketTiersInputSchema.parse([
        { ...validTier, name: '  General admission  ', description: '  Entry to the market.  ' },
        { ...validTier, name: 'VIP', sortOrder: 2 },
        { ...validTier, name: 'Late entry', sortOrder: 3 },
      ]),
    ).toEqual([
      { ...validTier, name: 'General admission', description: 'Entry to the market.' },
      { ...validTier, name: 'VIP', sortOrder: 2 },
      { ...validTier, name: 'Late entry', sortOrder: 3 },
    ])
  })

  it('normalizes a blank optional description to null', () => {
    expect(ticketTiersInputSchema.parse([{ ...validTier, description: '   ' }])[0]?.description).toBe(null)
  })

  it.each([
    [[], 'no tiers'],
    [[validTier, { ...validTier, name: 'VIP', sortOrder: 2 }, { ...validTier, name: 'Late', sortOrder: 3 }, { ...validTier, name: 'Door', sortOrder: 4 }], 'four tiers'],
    [[validTier, { ...validTier, name: '  general admission  ', sortOrder: 2 }], 'duplicate normalized tier names'],
    [[validTier, { ...validTier, name: 'VIP' }], 'duplicate sort orders'],
  ])('rejects %s', (tiers) => {
    expect(ticketTiersInputSchema.safeParse(tiers).success).toBe(false)
  })

  it.each([
    [{ ...validTier, name: ' ' }, 'an empty trimmed name'],
    [{ ...validTier, name: 'x'.repeat(81) }, 'a name over 80 characters'],
    [{ ...validTier, description: 'x'.repeat(241) }, 'a description over 240 characters'],
    [{ ...validTier, unitAmountMinor: 0 }, 'a zero price'],
    [{ ...validTier, unitAmountMinor: 100_000_000 }, 'a price over the USD minor-unit maximum'],
    [{ ...validTier, unitAmountMinor: 1.5 }, 'a fractional price'],
    [{ ...validTier, currency: 'cad' }, 'a non-USD currency'],
    [{ ...validTier, quantityTotal: 0 }, 'a zero capacity'],
    [{ ...validTier, quantityTotal: 1.5 }, 'a fractional capacity'],
    [{ ...validTier, quantityTotal: 2_147_483_648 }, 'an overlarge capacity'],
    [{ ...validTier, sortOrder: 0 }, 'an invalid sort order'],
  ])('rejects %s (%s)', (tier) => {
    expect(ticketTiersInputSchema.safeParse([tier]).success).toBe(false)
  })
})

type HasAll<Required, Available> = Exclude<Required, Available> extends never ? true : false

function assertGeneratedDatabaseSurface<Surface extends true>(surface: Surface): Surface {
  return surface
}
