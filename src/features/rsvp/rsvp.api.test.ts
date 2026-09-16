import { describe, expect, it, vi } from 'vitest'
import { createRsvpApi } from './rsvp.api'
const id = 'd6100000-0000-4000-8000-000000000001'
const attempt = {
  requestId: id,
  collectionBearer: 'rsvp_' + 'A'.repeat(43),
  submission: { eventId: id, name: 'Alex Chen', email: 'alex@example.invalid', quantity: 3 },
}
describe('RSVP transport', () => {
  it('sends no payment or organizer authority', async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ kind: 'confirmed', registrationId: id, eventId: id, quantity: 3 }),
      )
    )
    const api = createRsvpApi(fetch)
    await api.confirm(attempt)
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/functions/v1/free-rsvp')
    expect(JSON.parse(options.body as string)).toEqual({
      ...attempt.submission,
      requestId: id,
      collectionBearer: attempt.collectionBearer,
    })
    expect(options.credentials).toBe('omit')
    expect(options.referrerPolicy).toBe('no-referrer')
  })
  it('network failure stays uncertain, not a rejection', async () => {
    await expect(
      createRsvpApi(async () => {
        throw new Error('offline')
      }).confirm(attempt),
    ).rejects.toThrow('not confirmed')
  })
  it('status read cannot create a registration', async () => {
    let url = ''
    let body = ''
    const api = createRsvpApi(async (u, options) => {
      url = String(u)
      body = String(options?.body)
      return new Response(JSON.stringify({ kind: 'not_found' }))
    })
    expect(await api.resolve(attempt)).toEqual({ kind: 'not_found' })
    expect(url).toContain('free-rsvp-status')
    expect(JSON.parse(body)).toEqual({ requestId: id, collectionBearer: attempt.collectionBearer })
  })
})
