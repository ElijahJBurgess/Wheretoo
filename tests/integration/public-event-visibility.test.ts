import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll, describe, expect, it } from 'vitest'
import type { Database } from '../../src/lib/supabase/database.types'
import { waitForApiJwtAcceptance } from '../shared/waitForApiJwtAcceptance'
import { loadIntegrationTestEnv } from './testEnv'

const env = loadIntegrationTestEnv()

function createTestClient() {
  return createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

const organizerA = createTestClient()
const organizerB = createTestClient()
const anonymous = createTestClient()

type TestClient = typeof organizerA

function assertNoError(error: { message: string } | null, operation: string): asserts error is null {
  if (error) {
    throw new Error(`${operation}: ${error.message}`)
  }
}

async function signIn(client: TestClient, email: string, password: string) {
  const { data, error } = await client.auth.signInWithPassword({ email, password })

  assertNoError(error, 'Disposable organizer sign-in failed')
  expect(data.user).not.toBeNull()

  return data.user!
}

async function ensureOwnOrganizer(client: TestClient, userId: string, displayName: string) {
  const lookup = await client.from('organizers').select('id').eq('id', userId).maybeSingle()
  assertNoError(lookup.error, 'Organizer profile lookup failed')

  const mutableProfile = {
    display_name: displayName,
    organizer_type: 'Integration test organizer',
    bio: 'Disposable profile used to verify the Day 1 organizer publishing boundary.',
    website_url: null,
    base_city: 'San Francisco',
    country_code: 'US',
    onboarding_completed_at: new Date().toISOString(),
  }

  const write =
    lookup.data === null
      ? await client
          .from('organizers')
          .insert({ id: userId, ...mutableProfile })
          .select('id, display_name')
          .single()
      : await client
          .from('organizers')
          .update(mutableProfile)
          .eq('id', userId)
          .select('id, display_name')
          .single()

  assertNoError(write.error, 'Organizer profile write failed')
  expect(write.data).toEqual({ id: userId, display_name: displayName })
}

afterAll(async () => {
  await Promise.all([organizerA.auth.signOut(), organizerB.auth.signOut()])
})

describe('public event visibility and organizer isolation', () => {
  it('publishes one owned draft immediately without exposing it before publication', async () => {
    const runId = randomUUID()
    const title = `WHERETO_DAY1_INTEGRATION_${runId}`
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000)
    const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1_000)

    const [userA, userB] = await Promise.all([
      signIn(organizerA, env.organizerAEmail, env.organizerAPassword),
      signIn(organizerB, env.organizerBEmail, env.organizerBPassword),
    ])
    expect(userA.id).not.toBe(userB.id)

    await Promise.all([
      waitForApiJwtAcceptance(() => organizerA.from('organizers').select('id').limit(0)),
      waitForApiJwtAcceptance(() => organizerB.from('organizers').select('id').limit(0)),
    ])

    await Promise.all([
      ensureOwnOrganizer(organizerA, userA.id, `Organizer A ${runId}`),
      ensureOwnOrganizer(organizerB, userB.id, `Organizer B ${runId}`),
    ])

    const inserted = await organizerA
      .from('events')
      .insert({
        organizer_id: userA.id,
        title,
        description: 'A real disposable event proving immediate public visibility and ownership isolation.',
        category: 'community',
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        timezone: 'America/Los_Angeles',
        venue_name: 'Whereto Integration Venue',
        address_line1: '1 Market Street',
        address_line2: null,
        city: 'San Francisco',
        region: 'CA',
        postal_code: '94105',
        country_code: 'US',
        mapbox_feature_id: `whereto.integration.${runId}`,
        latitude: 37.7936,
        longitude: -122.3958,
        admission_type: 'free',
        capacity: 25,
      })
      .select('id, organizer_id, status, moderation_status, title, starts_at, ends_at, published_at')
      .single()

    assertNoError(inserted.error, 'Organizer A draft insert failed')
    expect(inserted.data).toMatchObject({
      organizer_id: userA.id,
      status: 'draft',
      moderation_status: 'clear',
      title,
      published_at: null,
    })
    expect(new Date(inserted.data.starts_at!).toISOString()).toBe(startsAt.toISOString())
    expect(new Date(inserted.data.ends_at!).toISOString()).toBe(endsAt.toISOString())
    const eventId = inserted.data.id
    const persistedStartsAt = inserted.data.starts_at
    const persistedEndsAt = inserted.data.ends_at

    const bRead = await organizerB.from('events').select('id').eq('id', eventId).maybeSingle()
    assertNoError(bRead.error, 'Organizer B isolation read failed unexpectedly')
    expect(bRead.data).toBeNull()

    const tamperedTitle = `${title}_TAMPERED`
    const bUpdate = await organizerB
      .from('events')
      .update({ title: tamperedTitle })
      .eq('id', eventId)
      .select('id, title')
    assertNoError(bUpdate.error, 'Organizer B isolation update failed unexpectedly')
    expect(bUpdate.data).toEqual([])

    const unchanged = await organizerA
      .from('events')
      .select('id, organizer_id, status, title')
      .eq('id', eventId)
      .single()
    assertNoError(unchanged.error, 'Organizer A verification read failed')
    expect(unchanged.data).toEqual({
      id: eventId,
      organizer_id: userA.id,
      status: 'draft',
      title,
    })

    const anonymousDraft = await anonymous.from('events').select('id').eq('id', eventId).maybeSingle()
    assertNoError(anonymousDraft.error, 'Anonymous draft visibility check failed unexpectedly')
    expect(anonymousDraft.data).toBeNull()

    const firstPublish = await organizerA.rpc('publish_event', { p_event_id: eventId })
    assertNoError(firstPublish.error, 'First publish failed')
    expect(firstPublish.data).toMatchObject({
      id: eventId,
      organizer_id: userA.id,
      status: 'published',
      moderation_status: 'clear',
      title,
    })
    expect(firstPublish.data.published_at).not.toBeNull()
    const firstPublishedAt = firstPublish.data.published_at

    const publicRead = await anonymous
      .from('events')
      .select(
        'id, organizer_id, status, moderation_status, title, description, starts_at, ends_at, timezone, city, region, country_code, admission_type, published_at',
      )
      .eq('id', eventId)
      .single()
    assertNoError(publicRead.error, 'Anonymous published-event read failed')
    expect(publicRead.data).toEqual({
      id: eventId,
      organizer_id: userA.id,
      status: 'published',
      moderation_status: 'clear',
      title,
      description: 'A real disposable event proving immediate public visibility and ownership isolation.',
      starts_at: persistedStartsAt,
      ends_at: persistedEndsAt,
      timezone: 'America/Los_Angeles',
      city: 'San Francisco',
      region: 'CA',
      country_code: 'US',
      admission_type: 'free',
      published_at: firstPublishedAt,
    })

    const retryPublish = await organizerA.rpc('publish_event', { p_event_id: eventId })
    assertNoError(retryPublish.error, 'Publish retry failed')
    expect(retryPublish.data.id).toBe(eventId)
    expect(retryPublish.data.published_at).toBe(firstPublishedAt)
  }, 45_000)
})
