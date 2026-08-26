import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Json } from '../../src/lib/supabase/database.types'
import { waitForApiJwtAcceptance } from '../shared/waitForApiJwtAcceptance'
import { createIntegrationTestClient, loadIntegrationTestEnv } from './testEnv'

const env = loadIntegrationTestEnv()
const ticketingRunId = randomUUID()
const organizerA = createIntegrationTestClient(env)
const organizerB = createIntegrationTestClient(env)
const anonymous = createIntegrationTestClient(env)
let organizerAId = ''
let organizerBId = ''

function expectCode(error: { message: string } | null, code: string) {
  expect(error?.message).toBe(code)
}

async function createPaidDraft(owner: typeof organizerA, ownerId: string, suffix: string) {
  const startsAt = new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000)
  const result = await owner.from('events').insert({
    organizer_id: ownerId,
    title: `WHERETO_DAY2_INTEGRATION_${ticketingRunId}_${suffix}`,
    description: 'A disposable paid event proving the hosted ticketing database boundary.',
    category: 'community',
    starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + 2 * 60 * 60 * 1_000).toISOString(),
    timezone: 'America/Los_Angeles',
    venue_name: 'Whereto Integration Venue',
    address_line1: '1 Market Street',
    city: 'San Francisco',
    region: 'CA',
    postal_code: '94105',
    country_code: 'US',
    mapbox_feature_id: `whereto.integration.${ticketingRunId}.${suffix}`,
    latitude: 37.7936,
    longitude: -122.3958,
    admission_type: 'paid',
  }).select('id').single()
  expect(result.error).toBeNull()
  return result.data!.id
}

async function saveOneTier(owner: typeof organizerA, eventId: string, amount = 2_000) {
  return owner.rpc('save_ticket_tiers', {
    p_event_id: eventId,
    p_tiers: [{
      name: 'General admission',
      description: 'One hosted integration ticket',
      unit_amount_minor: amount,
      currency: 'usd',
      quantity_total: 1,
      sort_order: 1,
    }],
  })
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    organizerA.auth.signInWithPassword({ email: env.organizerAEmail, password: env.organizerAPassword }),
    organizerB.auth.signInWithPassword({ email: env.organizerBEmail, password: env.organizerBPassword }),
  ])
  expect(a.error).toBeNull()
  expect(b.error).toBeNull()
  organizerAId = a.data.user!.id
  organizerBId = b.data.user!.id
  expect(organizerAId).not.toBe(organizerBId)
  await Promise.all([
    waitForApiJwtAcceptance(() => organizerA.from('organizers').select('id').limit(0)),
    waitForApiJwtAcceptance(() => organizerB.from('organizers').select('id').limit(0)),
  ])
}, 30_000)

describe('hosted ticketing database boundary', () => {
  it('isolates owned tiers and rejects browser-supplied financial and ownership fields', async () => {
    const eventId = await createPaidDraft(organizerA, organizerAId, 'isolation')
    const saved = await saveOneTier(organizerA, eventId)
    expect(saved.error).toBeNull()
    expect(saved.data).toHaveLength(1)
    const tierId = saved.data![0].id

    const reservationInput = {
      p_event_id: eventId,
      p_tier_id: tierId,
      p_name: 'Denied Browser Buyer',
      p_email: 'denied-browser@example.invalid',
      p_client_request_id: randomUUID(),
      p_confirmation_token_hash: 'a'.repeat(64),
    }
    const [authenticatedReservation, anonymousReservation] = await Promise.all([
      organizerA.rpc('server_reserve_checkout', reservationInput),
      anonymous.rpc('server_reserve_checkout', reservationInput),
    ])
    expect(authenticatedReservation.data).toBeNull()
    expect(anonymousReservation.data).toBeNull()
    expect(authenticatedReservation.error?.message).toMatch(/permission denied for function server_reserve_checkout/i)
    expect(anonymousReservation.error?.message).toMatch(/permission denied for function server_reserve_checkout/i)

    const crossOwner = await organizerB.rpc('list_owned_ticket_tiers', { p_event_id: eventId })
    expectCode(crossOwner.error, 'EVENT_NOT_FOUND')

    const manipulated = await organizerA.rpc('save_ticket_tiers', {
      p_event_id: eventId,
      p_tiers: [{
        name: 'Tampered',
        unit_amount_minor: 1,
        currency: 'usd',
        quantity_total: 1,
        sort_order: 1,
        organizer_id: organizerBId,
        application_fee_amount_minor: 0,
        destination: 'acct_attacker',
      }] as Json,
    })
    expectCode(manipulated.error, 'TIER_INVALID')

    const unchanged = await organizerA.rpc('list_owned_ticket_tiers', { p_event_id: eventId })
    expect(unchanged.error).toBeNull()
    expect(unchanged.data).toMatchObject([{ name: 'General admission', unit_amount_minor: 2_000 }])
  })

  it('blocks incomplete tier and Connect states, then publishes only the ready owned event', async () => {
    const noTierEvent = await createPaidDraft(organizerA, organizerAId, 'no-tier')
    const noTier = await organizerA.rpc('activate_paid_sales', { p_event_id: noTierEvent })
    expectCode(noTier.error, 'TIER_NOT_ACTIVE')

    const noConnectEvent = await createPaidDraft(organizerB, organizerBId, 'no-connect')
    const noConnectTier = await saveOneTier(organizerB, noConnectEvent)
    expect(noConnectTier.error).toBeNull()
    const mismatchedTierId = noConnectTier.data![0].id
    const noConnect = await organizerB.rpc('activate_paid_sales', { p_event_id: noConnectEvent })
    expectCode(noConnect.error, 'CONNECT_NOT_READY')

    const publicEvent = await createPaidDraft(organizerA, organizerAId, 'public')
    const tier = await saveOneTier(organizerA, publicEvent, 2_000)
    expect(tier.error).toBeNull()
    const activated = await organizerA.rpc('activate_paid_sales', { p_event_id: publicEvent })
    expect(activated.error).toBeNull()
    expect(activated.data).toMatchObject({ id: publicEvent, admission_type: 'paid', status: 'published' })

    const projection = await anonymous.rpc('get_public_event_ticketing', { p_event_id: publicEvent })
    expect(projection.error).toBeNull()
    expect(projection.data).toHaveLength(1)
    expect(projection.data![0]).toEqual(expect.objectContaining({
      event: expect.objectContaining({ id: publicEvent, admission_type: 'paid' }),
      tiers: [expect.objectContaining({ unit_amount_minor: 2_000, currency: 'usd' })],
    }))
    const serialized = JSON.stringify(projection.data)
    expect(serialized).not.toMatch(/fee|stripe|destination|quantity_total|reserved_quantity|buyer_/i)
    expect(serialized).not.toContain(mismatchedTierId)

    const nonpublicProjection = await anonymous.rpc('get_public_event_ticketing', {
      p_event_id: noConnectEvent,
    })
    expect(nonpublicProjection.error).toBeNull()
    expect(nonpublicProjection.data).toEqual([])
  })

  it.each([
    'organizer_stripe_accounts',
    'platform_fee_rules',
    'orders',
    'order_items',
    'tickets',
    'refunds',
    'disputes',
    'stripe_webhook_events',
  ] as const)('denies anonymous reads of %s', async (table) => {
    const result = await anonymous.from(table).select('*').limit(1)
    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
  })
})
