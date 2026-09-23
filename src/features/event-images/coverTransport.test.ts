import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ session: vi.fn(), fetch: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { auth: { getSession: mocks.session } } }))
vi.mock('../../lib/env', () => ({ publicEnv: { supabaseUrl: 'https://fixture.invalid', supabasePublishableKey: 'public-fixture' } }))
import { mutateCover } from './coverTransport'
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.session.mockResolvedValue({ data: { session: { access_token: 'fixture-token' } } })
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ revision: 8 }), { status: 200 }))
})
it('transmits the displayed revision and request identity for manual uploads', async () => {
  const file = new File(['fixture'], 'cover.png', { type: 'image/png' })
  await mutateCover('event', 7, { file }, () => true)
  const options = mocks.fetch.mock.calls[0][1]
  expect(options.method).toBe('POST')
  expect(options.headers['x-cover-revision']).toBe('7')
  expect(options.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  expect(options.body).toBe(file)
})
it('selects by generation and slot without sending arbitrary storage paths', async () => {
  await mutateCover('event', 7, { generationId: 'generation', slot: 2 }, () => true)
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ generationId: 'generation', slot: 2 })
})
it('fails closed after identity loss and for missing displayed revision', async () => {
  await expect(mutateCover('event', 7, { remove: true }, () => false)).rejects.toThrow('session changed')
  await expect(mutateCover('event', -1, { remove: true }, () => true)).rejects.toThrow('Refresh flyer')
  expect(mocks.fetch).not.toHaveBeenCalled()
})
it('requires explicit refresh on conflicts; never retries with a new revision', async () => {
  mocks.fetch.mockResolvedValue(new Response('{}', { status: 409 }))
  await expect(mutateCover('event', 7, { remove: true }, () => true)).rejects.toThrow('Refresh flyer')
  expect(mocks.fetch).toHaveBeenCalledOnce()
})
