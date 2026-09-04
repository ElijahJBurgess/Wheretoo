import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { waitForApiJwtAcceptance } from '../shared/waitForApiJwtAcceptance'
import { createIntegrationTestClient, loadIntegrationTestEnv } from './testEnv'

const env = loadIntegrationTestEnv()
const ticketingRunId = randomUUID()
const first = createIntegrationTestClient(env)
const retry = createIntegrationTestClient(env)
let organizerId = ''

beforeAll(async () => {
  const [a, b] = await Promise.all([
    first.auth.signInWithPassword({ email: env.organizerAEmail, password: env.organizerAPassword }),
    retry.auth.signInWithPassword({ email: env.organizerAEmail, password: env.organizerAPassword }),
  ])
  expect(a.error).toBeNull()
  expect(b.error).toBeNull()
  organizerId = a.data.user!.id
  expect(b.data.user!.id).toBe(organizerId)
  await Promise.all([
    waitForApiJwtAcceptance(() => first.from('organizers').select('id').limit(0)),
    waitForApiJwtAcceptance(() => retry.from('organizers').select('id').limit(0)),
  ])
}, 30_000)

describe('hosted ticketing concurrency boundary', () => {
  it('serializes concurrent paid activation retries without duplicating the final tier', async () => {
    const startsAt = new Date(Date.now() + 9 * 24 * 60 * 60 * 1_000)
    const inserted = await first.from('events').insert({
      organizer_id: organizerId,
      title: `WHERETO_DAY2_INTEGRATION_${ticketingRunId}_concurrency`,
      description: 'A one-ticket event proving concurrent paid activation remains idempotent.',
      category: 'community',
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 60 * 60 * 1_000).toISOString(),
      timezone: 'America/Los_Angeles',
      venue_name: 'Whereto Concurrency Venue',
      address_line1: '1 Market Street',
      city: 'San Francisco',
      region: 'CA',
      postal_code: '94105',
      country_code: 'US',
      mapbox_feature_id: `whereto.integration.${ticketingRunId}.concurrency`,
      latitude: 37.7936,
      longitude: -122.3958,
      admission_type: 'paid',
    }).select('id').single()
    expect(inserted.error).toBeNull()
    const eventId = inserted.data!.id

    const tier = await first.rpc('save_ticket_tiers', {
      p_event_id: eventId,
      p_tiers: [
        {
          name: 'Final ticket',
          description: null,
          unit_amount_minor: 3_001,
          currency: 'usd',
          quantity_total: 1,
          sort_order: 1,
        },
        {
          name: 'Supporting ticket',
          description: null,
          unit_amount_minor: 2_001,
          currency: 'usd',
          quantity_total: 2,
          sort_order: 2,
        },
      ],
    })
    expect(tier.error).toBeNull()

    const [one, two] = await Promise.all([
      first.rpc('activate_paid_sales', { p_event_id: eventId }),
      retry.rpc('activate_paid_sales', { p_event_id: eventId }),
    ])
    expect(one.error).toBeNull()
    expect(two.error).toBeNull()
    expect(one.data!.id).toBe(eventId)
    expect(two.data!.id).toBe(eventId)
    expect(one.data!.published_at).toBe(two.data!.published_at)

    const tiers = await first.rpc('list_owned_ticket_tiers', { p_event_id: eventId })
    expect(tiers.error).toBeNull()
    expect(tiers.data).toMatchObject([
      { name: 'Final ticket', quantity_total: 1, status: 'active' },
      { name: 'Supporting ticket', quantity_total: 2, status: 'active' },
    ])
  })
})
