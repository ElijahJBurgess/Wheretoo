import { z } from 'zod'
import type { AdmissionChecker } from '../contracts/admission'

const inputSchema = z.strictObject({
  eventId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  credential: z.string().regex(/^wta1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/),
})
const admissionLabel = z.string().refine((value) => value.trim() === value && [...value].length >= 1 && [...value].length <= 80)
const responseSchema = z.union([
  z.strictObject({ outcome: z.enum(['admitted', 'already_used', 'refunded', 'cancelled']), admissionLabel }),
  z.strictObject({ outcome: z.enum(['admitted', 'already_used']), admissionLabel, attendeeLabel: z.string().max(200), usedAt: z.iso.datetime({ offset: true }) }),
  z.strictObject({ outcome: z.enum(['refunded', 'cancelled']), admissionLabel, attendeeLabel: z.string().max(200) }),
  z.strictObject({ outcome: z.enum(['wrong_event', 'invalid', 'network_error']) }),
])
type InvokeAdmission = (
  name: 'ticket-admission',
  options: { body: { eventId: string; credential: string }; signal?: AbortSignal },
) => Promise<{ data: unknown; error: unknown }>

async function invokeAuthenticatedAdmission(...args: Parameters<InvokeAdmission>) {
  // Only protected scanner operations evaluate the existing session-aware client.
  const { supabase } = await import('../../../lib/supabase/client')
  return supabase.functions.invoke(...args)
}

export function createAdmissionChecker(invoke: InvokeAdmission = invokeAuthenticatedAdmission): AdmissionChecker {
  return {
    async checkAdmission({ eventId, credential, signal }) {
      signal?.throwIfAborted()
      const input = inputSchema.safeParse({ eventId, credential })
      if (!inputSchema.shape.eventId.safeParse(eventId).success) return { outcome: 'context_unavailable' }
      if (!input.success) return { outcome: 'invalid' }
      try {
        const { data, error } = await invoke('ticket-admission', { body: input.data, signal })
        if (error) return { outcome: 'network_error' }
        const parsed = responseSchema.safeParse(data)
        return parsed.success ? parsed.data : { outcome: 'network_error' }
      } catch {
        signal?.throwIfAborted()
        return { outcome: 'network_error' }
      }
    },
  }
}
