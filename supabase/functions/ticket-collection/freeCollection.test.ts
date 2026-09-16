import { assertEquals } from '@std/assert'
import { freeCollectionFromProjection } from './freeCollection.ts'
import { createFreeManifest } from '../_shared/freeRegistration.ts'
const id = 'd6100000-0000-4000-8000-000000000001'
const secret = new Uint8Array(32).fill(7)
async function projection() {
  const manifest = await createFreeManifest(secret, id, 3)
  return {
    registration_id: id,
    request_id: id,
    event_id: id,
    organizer_id: id,
    registration_status: 'confirmed',
    quantity: 3,
    name: 'Alex Chen',
    event_title: 'Free picnic',
    event_starts_at: '2027-01-01T12:00:00Z',
    event_ends_at: '2027-01-01T14:00:00Z',
    event_timezone: 'America/Los_Angeles',
    event_venue_name: 'City Park',
    event_status: 'published',
    event_address: '1 Test Street',
    tickets: manifest.map((m, index) => ({
      id: `d6100000-0000-4000-8000-00000000000${index + 2}`,
      ...m,
      admission_label: 'Free RSVP',
      status: 'valid',
      used_at: null,
    })),
  }
}
Deno.test('coherent free collection returns exactly three stable individual credentials', async () => {
  const value = await projection()
  const collection = await freeCollectionFromProjection(value, () => secret)
  assertEquals(collection?.tickets.length, 3)
  assertEquals(collection?.tickets.map((t) => t.selector), value.tickets.map((t) => t.id))
  assertEquals(new Set(collection?.tickets.map((t) => t.admissionCredential)).size, 3)
  assertEquals(collection?.tickets[0].attendeeLabel, 'Alex Chen')
  assertEquals(collection?.tickets[0].timezone, 'America/Los_Angeles')
})
Deno.test('cancelled registration preserves Used and returns no live cancelled QR', async () => {
  const value = await projection()
  value.registration_status = 'cancelled'
  value.event_status = 'cancelled'
  const tickets = value.tickets.map((t, i) => ({
    ...t,
    status: i === 0 ? 'used' : 'cancelled',
    used_at: i === 0 ? '2026-12-01T12:00:00Z' : null,
  }))
  const collection = await freeCollectionFromProjection({ ...value, tickets }, () => secret)
  assertEquals(collection?.tickets.map((t) => t.status), ['used', 'cancelled', 'cancelled'])
  assertEquals(collection?.tickets.every((t) => t.admissionCredential === null), true)
  assertEquals(collection?.tickets[0].usedAt, '2026-12-01T12:00:00Z')
})
Deno.test('all-used cancelled registration retains cancellation independently of admission history', async () => {
  const value = await projection()
  value.registration_status = 'cancelled'
  value.event_status = 'cancelled'
  value.event_timezone = 'America/New_York'
  const collection = await freeCollectionFromProjection({
    ...value,
    tickets: value.tickets.map((t) => ({ ...t, status: 'used', used_at: '2026-12-01T12:00:00Z' })),
  }, () => secret)
  assertEquals(collection?.registrationStatus, 'cancelled')
  assertEquals(collection?.tickets[0].timezone, 'America/New_York')
  assertEquals(collection?.tickets.every((t) => t.status === 'used'), true)
  assertEquals(
    await freeCollectionFromProjection({ ...value, event_timezone: 'invalid/zone' }, () => secret),
    null,
  )
})
Deno.test('partial, mismatched, duplicate, refunded or forged free collection fails closed', async () => {
  for (
    const mutate of [
      (v: Awaited<ReturnType<typeof projection>>) => ({ ...v, tickets: v.tickets.slice(1) }),
      (v: Awaited<ReturnType<typeof projection>>) => ({
        ...v,
        tickets: [v.tickets[0], v.tickets[0], v.tickets[2]],
      }),
      (v: Awaited<ReturnType<typeof projection>>) => ({
        ...v,
        tickets: v.tickets.map((t) => ({ ...t, status: 'refunded' })),
      }),
      (v: Awaited<ReturnType<typeof projection>>) => ({
        ...v,
        tickets: v.tickets.map((t) => ({ ...t, credential_hash: 'a'.repeat(64) })),
      }),
    ]
  ) assertEquals(await freeCollectionFromProjection(mutate(await projection()), () => secret), null)
})
