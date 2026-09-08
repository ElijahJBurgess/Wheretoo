import { describe, expect, it } from 'vitest'
import type { Database } from '../../lib/supabase/database.types'
import type { OrderConfirmation } from '../orders/order.types'
import type { ConnectStatus } from '../payments/payment.types'
import type { PublicTicketingEvent, PublicTicketTier, PublicTicketTierTuple } from './ticket.types'
import { publicTicketingEventSchema, ticketTiersInputSchema } from './ticket.schemas'

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

  it('keeps the published browser contracts exact and exhaustive', () => {
    assertGeneratedDatabaseSurface<
      IsExact<
        ConnectStatus,
        | { status: 'not_started' }
        | (ConnectStatusSummary & { status: 'pending' })
        | (ConnectStatusSummary & { status: 'action_required' })
        | (ConnectStatusSummary & { status: 'restricted' })
        | (ConnectStatusSummary & { status: 'ready' })
      >
    >(true)
    assertGeneratedDatabaseSurface<
      IsExact<PublicTicketingEvent['tiers'], PublicTicketTierTuple | []>
    >(true)
    assertGeneratedDatabaseSurface<
      IsExact<PublicTicketingEvent['event']['admission_type'], 'free' | 'paid'>
    >(true)
    assertGeneratedDatabaseSurface<IsExact<PublicTicketTier['currency'], 'usd'>>(true)
    assertGeneratedDatabaseSurface<
      IsExact<
        keyof OrderConfirmation,
        | 'currency'
        | 'event'
        | 'items'
        | 'orderNumber'
        | 'quantity'
        | 'status'
        | 'subtotalMinor'
        | 'taxAmountMinor'
        | 'totalMinor'
      >
    >(true)
    assertGeneratedDatabaseSurface<
      IsExact<
        OrderConfirmation['status'],
        | 'processing'
        | 'paid'
        | 'payment_failed'
        | 'cancelled'
        | 'expired'
        | 'refunded'
        | 'requires_review'
      >
    >(true)
    assertGeneratedDatabaseSurface<
      IsExact<keyof OrderConfirmation['event'], 'endsAt' | 'startsAt' | 'timezone' | 'title' | 'venueName'>
    >(true)
    assertGeneratedDatabaseSurface<
      IsExact<
        keyof OrderConfirmation['items'][number],
        'currency' | 'quantity' | 'subtotalMinor' | 'tierName' | 'unitAmountMinor'
      >
    >(true)
    assertGeneratedDatabaseSurface<IsExact<OrderConfirmation['currency'], 'usd'>>(true)
    assertGeneratedDatabaseSurface<IsExact<OrderConfirmation['taxAmountMinor'], 0>>(true)

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

  it('accepts each inclusive persisted tier boundary', () => {
    expect(
      ticketTiersInputSchema.parse([
        {
          ...validTier,
          name: 'n'.repeat(80),
          description: 'd'.repeat(240),
          unitAmountMinor: 1,
          quantityTotal: 1,
        },
      ]),
    ).toMatchObject({
      0: {
        name: 'n'.repeat(80),
        description: 'd'.repeat(240),
        unitAmountMinor: 1,
        quantityTotal: 1,
      },
    })
    expect(
      ticketTiersInputSchema.parse([
        { ...validTier, unitAmountMinor: 99_999_999, quantityTotal: 2_147_483_647 },
      ]),
    ).toMatchObject({ 0: { unitAmountMinor: 99_999_999, quantityTotal: 2_147_483_647 } })
  })

  it('normalizes a valid upper-case RFC UUID tier ID to the lowercase database form', () => {
    expect(
      ticketTiersInputSchema.parse([
        { ...validTier, id: 'EB0FD9D5-D7D5-45DD-A99F-0C8A191BDC6F' },
      ])[0]?.id,
    ).toBe('eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f')
  })

  it.each([
    ['eb0fd9d5-d7d5-05dd-a99f-0c8a191bdc6f', 'a non-RFC version 1–5 UUID'],
    ['eb0fd9d5-d7d5-45dd-c99f-0c8a191bdc6f', 'a non-RFC variant UUID'],
  ])('rejects %s (%s)', (id) => {
    expect(ticketTiersInputSchema.safeParse([{ ...validTier, id }]).success).toBe(false)
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

describe('publicTicketingEventSchema', () => {
  it('accepts database-valid empty timezone and unrestricted address line two', () => {
    expect(
      publicTicketingEventSchema.safeParse({
        event: {
          id: 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f',
          title: 'Night Market',
          description: 'Food, music, and neighborhood makers.',
          category: 'community',
          starts_at: '2026-09-01T02:00:00+00:00',
          ends_at: '2026-09-01T05:00:00+00:00',
          timezone: '',
          venue_name: 'Civic Center Plaza',
          address_line1: '1 Dr Carlton B Goodlett Place',
          address_line2: 'A'.repeat(161),
          city: 'San Francisco',
          region: 'CA',
          postal_code: '94102',
          country_code: 'US',
          latitude: 37.7793,
          longitude: -122.4193,
          artwork_path: null,
          animation_preset: 'generic',
          admission_type: 'paid',
          minimum_age: 'all_ages',
          advisories: [],
          organizer: { id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe', display_name: 'Bay City Arts' },
        },
        tiers: [
          {
            id: '900a9142-9111-4f87-84d5-b8545a94c7fb',
            name: 'General admission',
            description: null,
            unit_amount_minor: 2_500,
            currency: 'usd',
            availability_status: 'available',
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('accepts only the successful paid-public projection with one to three active tiers', () => {
    expect(
      publicTicketingEventSchema.parse({
        event: {
          id: 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f',
          title: 'Night Market',
          description: 'Food, music, and neighborhood makers.',
          category: 'community',
          starts_at: '2026-09-01T02:00:00+00:00',
          ends_at: '2026-09-01T05:00:00+00:00',
          timezone: 'America/Los_Angeles',
          venue_name: 'Civic Center Plaza',
          address_line1: '1 Dr Carlton B Goodlett Place',
          address_line2: null,
          city: 'San Francisco',
          region: 'CA',
          postal_code: '94102',
          country_code: 'US',
          latitude: 37.7793,
          longitude: -122.4193,
          artwork_path: null,
          animation_preset: 'generic',
          admission_type: 'paid',
          minimum_age: 'all_ages',
          advisories: ['alcohol'],
          organizer: { id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe', display_name: 'Bay City Arts' },
        },
        tiers: [
          {
            id: '900a9142-9111-4f87-84d5-b8545a94c7fb',
            name: 'General admission',
            description: null,
            unit_amount_minor: 2_500,
            currency: 'usd',
            availability_status: 'available',
          },
        ],
      }),
    ).toMatchObject({ event: { admission_type: 'paid' }, tiers: [{ currency: 'usd' }] })
  })

  it.each([
    [{ currency: 'cad' }, 'a non-USD tier'],
    [{ availability_status: 'active' }, 'a non-public availability state'],
    [{ admission_type: 'free' }, 'a free event'],
    [{ title: null }, 'a nullable publication field'],
    [{ category: 'sports' }, 'a category outside the database enum'],
  ])('rejects %s (%s)', (patch, reason) => {
    const validProjection = {
      event: {
        id: 'eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f',
        title: 'Night Market',
        description: 'Food, music, and neighborhood makers.',
        category: 'community',
        starts_at: '2026-09-01T02:00:00+00:00',
        ends_at: '2026-09-01T05:00:00+00:00',
        timezone: 'America/Los_Angeles',
        venue_name: 'Civic Center Plaza',
        address_line1: '1 Dr Carlton B Goodlett Place',
        address_line2: null,
        city: 'San Francisco',
        region: 'CA',
        postal_code: '94102',
        country_code: 'US',
        latitude: 37.7793,
        longitude: -122.4193,
        artwork_path: null,
        animation_preset: 'generic',
        admission_type: 'paid',
        minimum_age: 'all_ages',
        advisories: [],
        organizer: { id: '6b849fa0-4d5e-4faa-bf31-b169cb1bd7fe', display_name: 'Bay City Arts' },
      },
      tiers: [
        {
          id: '900a9142-9111-4f87-84d5-b8545a94c7fb',
          name: 'General admission',
          description: null,
          unit_amount_minor: 2_500,
          currency: 'usd',
          availability_status: 'available',
        },
      ],
    }

    const candidate =
      'admission_type' in patch || 'title' in patch
        ? { ...validProjection, event: { ...validProjection.event, ...patch } }
        : { ...validProjection, tiers: [{ ...validProjection.tiers[0], ...patch }] }

    expect(publicTicketingEventSchema.safeParse(candidate).success, reason).toBe(false)
  })
})

type HasAll<Required, Available> = Exclude<Required, Available> extends never ? true : false
type IsExact<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
  Value extends Right ? 1 : 2
  ? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
    ? true
    : false
  : false

type ConnectStatusSummary = Pick<
  Database['public']['Tables']['organizer_stripe_accounts']['Row'],
  | 'requirements_currently_due_count'
  | 'requirements_past_due_count'
  | 'last_status_code'
  | 'last_synced_at'
>

function assertGeneratedDatabaseSurface<Surface extends true>(surface: Surface): Surface {
  return surface
}
