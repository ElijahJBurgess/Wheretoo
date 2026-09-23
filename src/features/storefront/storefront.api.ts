import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../lib/supabase/database.types'
import { publicEnv } from '../../lib/env'
import { isValidHandle, normalizeHandle } from './storefront.handle'
import {
  type StorefrontCursor,
  storefrontDocumentSchema,
} from './storefront.schemas'
const publicClient = createClient<Database>(
  publicEnv.supabaseUrl,
  publicEnv.supabasePublishableKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'wheretoo-storefront-anonymous',
    },
  },
)
export async function readStorefront(
  handle: string,
  cursor: StorefrontCursor | null = null,
) {
  const normalized = normalizeHandle(handle)
  if (!isValidHandle(normalized)) return null
  const { data, error } = await publicClient.rpc(
    'get_public_organizer_storefront',
    { p_handle: normalized, p_cursor: cursor, p_limit: 5 },
  )
  if (error) {
    throw new Error(
      error.message === 'STOREFRONT_CURSOR_CHANGED'
        ? 'The event list changed. Refresh the storefront.'
        : 'Storefront could not load. Try again.',
    )
  }
  return data === null ? null : storefrontDocumentSchema.parse(data)
}
export function eventFlyerUrl(id: string) {
  return `${publicEnv.supabaseUrl}/functions/v1/event-images?id=${
    encodeURIComponent(id)
  }`
}
