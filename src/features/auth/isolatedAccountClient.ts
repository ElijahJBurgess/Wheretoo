import { AuthClient, AuthSessionMissingError, type Session } from '@supabase/supabase-js'
import { publicEnv } from '../../lib/env'

/** Isolate SDK session side effects without constructing unrelated Realtime browser listeners. */
export async function createIsolatedAccountClient(session: Session) {
  // Stay above the SDK's 90-second refresh threshold, allowing a small request-time margin.
  if (session.expires_at !== undefined && session.expires_at <= Math.floor(Date.now() / 1000) + 120) throw new AuthSessionMissingError()
  const authUrl = `${publicEnv.supabaseUrl.replace(/\/$/, '')}/auth/v1`
  const auth = new AuthClient({
    url: authUrl,
    fetch: async (input, init) => {
      const requestUrl = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const allowedUrl = requestUrl.origin + requestUrl.pathname
      const expired = session.expires_at !== undefined && session.expires_at <= Math.floor(Date.now() / 1000) + 90
      // autoRefreshToken:false does not disable refresh inside SDK reads. Never send the
      // shared refresh token from an isolated lifetime, including after a stalled request.
      if (expired || ![`${authUrl}/user`, `${authUrl}/reauthenticate`].includes(allowedUrl)) {
        return new Response(JSON.stringify({ error_code: 'session_not_found', message: 'Account session expired' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      }
      return fetch(input, init)
    },
    headers: { apikey: publicEnv.supabasePublishableKey },
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: `whereto-account-operation-${crypto.randomUUID()}`,
  })
  try {
    const { error } = await auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
    if (error) throw error
    return { auth }
  } catch (error) {
    await auth.dispose()
    throw error
  }
}
