/// <reference types="node" />
import { webcrypto } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
// The injected HTTP handler never reads the worker's provider keyring/bootstrap.
vi.mock('../../../supabase/functions/_shared/ticketEmailWorker.ts', () => ({ readTicketEmailPayloadKeys: () => { throw new Error('Unexpected worker bootstrap') } }))
vi.mock('../../lib/env', () => ({ publicEnv: { supabaseUrl: 'https://http-proof.invalid', supabasePublishableKey: 'public-fixture' } }))
import { TicketEmailAccessPage } from './TicketEmailAccessPage'
import { captureTicketAccess } from './delivery.session'
// Runtime import keeps Deno bootstrap/types out of the browser compilation. This
// test calls the actual handler and actual public client; no server is started.
const handlerPath = '../../../supabase/functions/_shared/ticketEmailHttp.ts'
const { createTicketEmailHttpHandler } = await import(handlerPath)
const origin = 'https://ticket-proof.invalid'
const token = 'em1_' + 'A'.repeat(43)
afterEach(() => { vi.unstubAllGlobals() })
it('actual RPC exception becomes HTTP 503 and the guest retries the same grant through the real public client', async () => {
  // Node WebCrypto needs its own ArrayBuffer realm rather than jsdom's realm.
  vi.stubGlobal('ArrayBuffer', Buffer.alloc(0).buffer.constructor)
  vi.stubGlobal('Uint8Array', Object.getPrototypeOf(Buffer))
  vi.stubGlobal('crypto', webcrypto)
  sessionStorage.clear()
  history.replaceState(null, '', '/ticket-access#' + token)
  captureTicketAccess()
  const stored = sessionStorage.getItem('wheretoo:ticket-email-access:v1')
  const calls: Record<string, unknown>[] = []
  const statuses: number[] = []
  const bodies: string[] = []
  const handler: (request: Request) => Promise<Response> = createTicketEmailHttpHandler('access', {
    appOrigin: origin, recoveryEnabled: false, keyId: '', keys: new Map(), fingerprintSecret: new Uint8Array(32).fill(7), getTrustedIp: () => '127.0.0.1', getCredentialSecret: () => new Uint8Array(32).fill(7),
    rpc: async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe('server_read_ticket_email_access')
      calls.push(args)
      if (calls.length === 1) throw new Error('private database infrastructure details')
      return { kind: 'index', expiresAt: '2099-01-01T00:00:00Z', total: 2, page: 0, nextPage: null, collections: [1, 2].map(selector => ({ selector, sourceKind: 'paid_order', eventName: 'Night', startsAt: '2098-01-01T00:00:00Z', quantity: 1, createdAt: '2026-09-01T00:00:00Z' })) }
    },
  })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    expect(request.url).toBe('https://http-proof.invalid/functions/v1/ticket-email-access')
    request.headers.set('origin', origin)
    const response = await handler(request)
    statuses.push(response.status)
    bodies.push(await response.clone().text())
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    return response
  })
  const router = createMemoryRouter([{ path: '/ticket-access', element: <TicketEmailAccessPage /> }], { initialEntries: ['/ticket-access'] })
  render(<RouterProvider router={router} />)
  expect(await screen.findByRole('heading', { name: 'Tickets temporarily unavailable' })).toBeVisible()
  expect(statuses).toEqual([503])
  expect(calls).toHaveLength(1)
  expect(bodies[0]).toBe('{"kind":"unavailable"}')
  expect(sessionStorage.getItem('wheretoo:ticket-email-access:v1')).toBe(stored)
  fireEvent.click(screen.getByRole('button', { name: 'Try this link again' }))
  await waitFor(() => expect(screen.getAllByText('Night')).toHaveLength(2))
  expect(statuses).toEqual([503, 200])
  expect(calls[0]).toEqual(calls[1])
  expect(calls[0]?.p_token_hash).toMatch(/^[0-9a-f]{64}$/)
  expect(JSON.stringify(calls)).not.toContain(token)
  expect(router.state.location.pathname + router.state.location.search).toBe('/ticket-access')
  expect(JSON.parse(sessionStorage.getItem('wheretoo:ticket-email-access:v1')!).expiresAt).toBeLessThanOrEqual(JSON.parse(stored!).expiresAt)
})
