/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { createNodeAdmissionChecker } from '../e2e/support/nodeAdmissionChecker'

// Load the actual Edge handler at runtime in Node; its Deno-only default
// environment and server bootstrap are never invoked by this local transport.
const handlerPath = '../../supabase/functions/ticket-admission/index.ts'
const authPath = '../../supabase/functions/_shared/auth.ts'
const { createTicketAdmissionHandler } = await import(handlerPath)
const { requireOrganizer } = await import(authPath)
const origin = 'https://whereto.example'
const eventId = 'a6200000-0000-4000-8000-000000000001'
const organizerId = 'a6100000-0000-4000-8000-000000000001'
const credential = `wta1_${'A'.repeat(43)}`

test.each(['approved', 'missing', 'wrong'] as const)(
  'Node proof SDK transport through actual handler: %s Origin', async (kind) => {
    let authCalls = 0
    let redemptionCalls = 0
    let observedOrigin: string | null = null
    let status = 0
    const handler = createTicketAdmissionHandler({
      appOrigin: origin,
      verifyOrganizer: (request: Request) => requireOrganizer(request, {
        getUser: async (token: string) => {
          authCalls++
          expect(token).toBe('local-proof-jwt')
          return { user: { id: organizerId }, error: null }
        },
        findOrganizerByUserId: async (id: string) => ({ organizer: { id }, error: null }),
      }),
      redeem: async () => {
        redemptionCalls++
        return { outcome: 'wrong_event', admission_label: null }
      },
    })
    // The SDK's sole fetch is intercepted. No Auth/Stripe/project requests or
    // real credentials are used; production CORS and auth parsing remain real.
    const client = createClient('https://local-proof.example', 'sb_publishable_local', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      accessToken: async () => 'local-proof-jwt',
      global: { fetch: async (input, init) => {
        const request = new Request(input, init)
        expect(request.url).toBe('https://local-proof.example/functions/v1/ticket-admission')
        if (kind === 'missing') request.headers.delete('origin')
        if (kind === 'wrong') request.headers.set('origin', 'https://other.example')
        observedOrigin = request.headers.get('origin')
        const response = await handler(request)
        status = response.status
        expect(response.headers.get('access-control-allow-origin')).toBe(kind === 'approved' ? origin : null)
        return response
      } },
    })
    const checker = createNodeAdmissionChecker(client, `${origin}/tickets/local-collection/local-ticket`)
    const result = await checker.checkAdmission({ eventId, credential })
    expect(result).toEqual({ outcome: kind === 'approved' ? 'wrong_event' : 'network_error' })
    expect(observedOrigin).toBe(kind === 'approved' ? origin : kind === 'wrong' ? 'https://other.example' : null)
    expect(status).toBe(kind === 'approved' ? 200 : 403)
    expect(authCalls).toBe(kind === 'approved' ? 1 : 0)
    expect(redemptionCalls).toBe(kind === 'approved' ? 1 : 0)
  },
)
