import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  normalizeFreeSubmission,
  parseFreeLocator,
} from '../../../src/features/rsvp/rsvp.contract.ts'
import { createFreeManifest, deriveFreeAdmissionCredential } from './freeRegistration.ts'
const requestId = 'd6100000-0000-4000-8000-000000000001'
const input = {
  eventId: requestId,
  quantity: 3,
  name: '  Alex   Chen ',
  email: ' ALEX@EXAMPLE.INVALID ',
}
Deno.test('free contact normalization is canonical', () => {
  assertEquals(normalizeFreeSubmission(input), {
    ...input,
    name: 'Alex Chen',
    email: 'alex@example.invalid',
  })
})
for (const quantity of [0, 11, 1.5, -1]) {
  Deno.test(`reject quantity ${quantity}`, () => {
    assertThrows(() => normalizeFreeSubmission({ ...input, quantity }))
  })
}
Deno.test('reject invalid contact and unknown client authority', () => {
  for (
    const patch of [{ name: '' }, { email: 'bad' }, { price: 0 }, { organizerId: requestId }, {
      status: 'confirmed',
    }]
  ) assertThrows(() => normalizeFreeSubmission({ ...input, ...patch }))
})
Deno.test('free locator is source-qualified canonical bearer', () => {
  assertEquals(parseFreeLocator('rsvp_' + 'A'.repeat(43)), 'A'.repeat(43))
  for (const value of ['A'.repeat(43), 'rsvp_' + 'A'.repeat(42) + 'B', 'rsvp_short']) {
    assertThrows(() => parseFreeLocator(value))
  }
})
Deno.test('free credential domain differs from paid while stable per request unit', async () => {
  const secret = new Uint8Array(32).fill(7)
  const first = await deriveFreeAdmissionCredential(secret, requestId, 1)
  assertEquals(first, 'wta1_7YxKyyttKMQafyUU7VePC_IIWDpgxDJrIZMsPlrV0Co')
  assertEquals(first, await deriveFreeAdmissionCredential(secret, requestId, 1))
  const { derivePaidAdmissionCredential } = await import('./ticketCredentials.ts')
  assertEquals(
    first ===
      await derivePaidAdmissionCredential(secret, { orderItemId: requestId, unitSequence: 1 }),
    false,
  )
  assertEquals(first === await deriveFreeAdmissionCredential(secret, requestId, 2), false)
  assertEquals(/^wta1_[A-Za-z0-9_-]{43}$/.test(first), true)
  await assertRejects(() => deriveFreeAdmissionCredential(secret, requestId, 11))
})
Deno.test('three units produce exact distinct credential manifest', async () => {
  const rows = await createFreeManifest(new Uint8Array(32).fill(7), requestId, 3)
  assertEquals(rows.map((r) => r.unit_sequence), [1, 2, 3])
  assertEquals(new Set(rows.map((r) => r.credential_hash)).size, 3)
  assertEquals(rows.every((r) => /^[a-f0-9]{64}$/.test(r.credential_hash)), true)
})
