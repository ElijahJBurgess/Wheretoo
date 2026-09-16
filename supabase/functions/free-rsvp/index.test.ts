import { assertEquals } from '@std/assert'
import { createFreeRsvpHandler, type FreeRsvpDependencies } from '../_shared/freeRsvpHandler.ts'
const id = 'd6100000-0000-4000-8000-000000000001'
const body = {
  eventId: id,
  quantity: 3,
  name: ' Alex  Chen ',
  email: ' Alex@Example.invalid ',
  requestId: id,
  collectionBearer: 'rsvp_' + 'A'.repeat(43),
}
function request(value: unknown = body, origin = 'https://example.invalid') {
  return new Request('https://edge.invalid/free-rsvp', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(value),
  })
}
function setup(mode: 'create' | 'status' = 'create') {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const dependencies: FreeRsvpDependencies = {
    appOrigin: 'https://example.invalid',
    getSecret: () => new Uint8Array(32).fill(7),
    rateLimit: () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }),
    rpc: async (name, args) => {
      calls.push({ name, args })
      return { kind: 'confirmed', registrationId: id, eventId: id, quantity: 3 }
    },
  }
  return { calls, dependencies, handler: createFreeRsvpHandler(mode, dependencies) }
}
Deno.test('confirmation sends normalized exact source manifest without Stripe dependencies', async () => {
  const { calls, handler } = setup()
  const response = await handler(request())
  assertEquals(response.status, 200)
  assertEquals(calls.length, 1)
  assertEquals(calls[0].name, 'server_confirm_free_registration')
  assertEquals(calls[0].args.p_name, 'Alex Chen')
  assertEquals(calls[0].args.p_email, 'alex@example.invalid')
  assertEquals((calls[0].args.p_ticket_manifest as unknown[]).length, 3)
  assertEquals(response.headers.get('cache-control'), 'private, no-store')
})
Deno.test('invalid input never invokes issuance', async () => {
  for (
    const value of [{ ...body, quantity: 11 }, { ...body, price: 0 }, {
      ...body,
      collectionBearer: 'A'.repeat(43),
    }]
  ) {
    const { calls, handler } = setup()
    assertEquals((await handler(request(value))).status, 400)
    assertEquals(calls.length, 0)
  }
})
Deno.test('unknown dependency outcome and exception remain uncertain', async () => {
  for (
    const rpc of [
      () => Promise.resolve({ kind: 'confirmed' }),
      () => Promise.reject(new Error('private proof')),
    ]
  ) {
    const { dependencies } = setup()
    const response = await createFreeRsvpHandler('create', { ...dependencies, rpc })(request())
    assertEquals(response.status, 503)
    assertEquals(await response.json(), { kind: 'unavailable' })
  }
})
Deno.test('resolve never invokes creation', async () => {
  const { handler, calls } = setup('status')
  await handler(request({ requestId: id, collectionBearer: body.collectionBearer }))
  assertEquals(calls[0].name, 'server_resolve_free_registration')
  assertEquals(Object.keys(calls[0].args).sort(), ['p_access_hash', 'p_request_id'])
})
Deno.test('cross origin and oversized requests never reach database', async () => {
  const { handler, calls } = setup()
  assertEquals((await handler(request(body, 'https://other.invalid'))).status, 403)
  assertEquals((await handler(request({ ...body, name: 'a'.repeat(20000) }))).status, 400)
  assertEquals(calls.length, 0)
})
Deno.test('throttling preserves identity and is not full', async () => {
  const { dependencies, calls } = setup()
  const response = await createFreeRsvpHandler('create', {
    ...dependencies,
    rateLimit: async () => ({ allowed: false, retryAfterSeconds: 30 }),
  })(request())
  assertEquals(response.status, 429)
  assertEquals(response.headers.get('retry-after'), '30')
  assertEquals(calls.length, 0)
})
