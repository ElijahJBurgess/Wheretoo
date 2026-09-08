import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdmissionChecker } from '../../../src/features/ticket-experience/adapters/admissionChecker'

export function createNodeAdmissionChecker(client: SupabaseClient, browserUrl: string) {
  // Node fetch does not supply the browser's Origin header automatically.
  const origin = new URL(browserUrl).origin
  return createAdmissionChecker((name, options) => client.functions.invoke(name, {
    ...options, headers: { Origin: origin },
  }))
}
