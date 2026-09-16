import { authStorageKey, authTransitionLock, createAuthFetch } from '../../features/auth/authTransitions'
import { createClient } from '@supabase/supabase-js'
import { publicEnv, type PublicEnv } from '../env'
import type { Database } from './database.types'

export function createWheretoClient(env: PublicEnv) {
  return createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    global: { fetch: createAuthFetch(env.supabaseUrl) },
    auth: {
      storageKey: authStorageKey(env.supabaseUrl),
      lock: authTransitionLock,
      lockAcquireTimeout: 15_000,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}

export const supabase = createWheretoClient(publicEnv)
