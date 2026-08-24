import { createClient } from '@supabase/supabase-js'
import { publicEnv, type PublicEnv } from '../env'
import type { Database } from './database.types'

export function createWheretoClient(env: PublicEnv) {
  return createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}

export const supabase = createWheretoClient(publicEnv)
