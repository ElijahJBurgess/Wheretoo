import { AuthClient, NavigatorLockAcquireTimeoutError, type Session } from '@supabase/supabase-js'
/** Matches the existing SDK default, keeping existing organizer sessions intact. */
export function authStorageKey(url: string): string {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
}

export class AuthCoordinationError extends NavigatorLockAcquireTimeoutError {
  readonly isAcquireTimeout = true
}

/** One same-origin gate, also supplied to the SDK for startup, sign-out and refresh.
 * Never steal a timed-out lock: its previous holder could still remove a session.
 */
export async function authTransitionLock<T>(name: string, timeout: number, operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request || typeof BroadcastChannel !== 'function') {
    throw new AuthCoordinationError('Organizer sign-in requires a browser with secure cross-tab coordination. Update your browser and try again.')
  }
  try {
    const channel = new BroadcastChannel('whereto-auth-coordination-support')
    channel.close()
  } catch {
    throw new AuthCoordinationError('Organizer sign-in requires working cross-tab notifications. Check your browser settings and try again.')
  }
  const controller = new AbortController()
  const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : undefined
  try {
    return await navigator.locks.request(name, timeout === 0 ? { mode: 'exclusive', ifAvailable: true } : { mode: 'exclusive', signal: controller.signal }, async lock => {
      clearTimeout(timer)
      if (!lock) throw new AuthCoordinationError('Another organizer session change is in progress. Try again shortly.')
      return operation()
    })
  } catch (error) {
    if (controller.signal.aborted) throw new AuthCoordinationError('Another organizer session change is still in progress. Try again shortly.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Password methods do not use the SDK's custom lock in auth-js 2.112.3. */
export async function passwordAuthTransition<T>(
  auth: { initialize: () => Promise<{ error: unknown }> },
  storageKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const { error } = await auth.initialize()
  if (error) throw error
  return authTransitionLock(`lock:${storageKey}`, 15_000, operation)
}

/** Bound both headers and body before the SDK consumes an Auth response. A late
 * provider response cannot resume session writes after this promise has timed out.
 */
export function createAuthFetch(supabaseUrl: string, timeoutMs = 15_000): typeof fetch {
  const authPrefix = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/`
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(authPrefix)) return fetch(input, init)
    const controller = new AbortController()
    const originalSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const abort = () => controller.abort(originalSignal?.reason)
    if (originalSignal?.aborted) abort()
    else originalSignal?.addEventListener('abort', abort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(input, { ...init, signal: controller.signal })
          const body = [204, 205, 304].includes(response.status) ? null : await response.arrayBuffer()
          return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Organizer authentication timed out. Try again.'))
            controller.abort()
          }, timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
      originalSignal?.removeEventListener('abort', abort)
    }
  }
}

export type SignOutIdentity = Pick<Session, 'access_token' | 'refresh_token'> & { user: Pick<Session['user'], 'id'> }
export type CoordinatedSignOutResult = {
  localSignedOut: boolean
  remoteRevoked: boolean
  sessionChanged: boolean
}

/** Bind logout to its invocation identity before waiting for any other tab.
 * The operation client uses only public SDK methods and the existing SDK storage.
 * Its local lock is closed and drained before the outer cross-tab gate is released.
 */
export async function signOutExpectedSession(
  env: { supabaseUrl: string; supabasePublishableKey: string },
  expected: SignOutIdentity,
  isCurrent: () => boolean,
): Promise<CoordinatedSignOutResult> {
  const changed = { localSignedOut: false, remoteRevoked: false, sessionChanged: true }
  const storageKey = authStorageKey(env.supabaseUrl)
  return authTransitionLock(`lock:${storageKey}`, 15_000, async () => {
    if (!isCurrent()) return changed
    let closed = false
    const pending = new Set<Promise<unknown>>()
    const localLock = <T,>(_name: string, _timeout: number, operation: () => Promise<T>): Promise<T> => {
      if (closed) return Promise.reject(new AuthCoordinationError('This organizer session change has ended.'))
      const task = Promise.resolve().then(() => {
        if (closed) throw new AuthCoordinationError('This organizer session change has ended.')
        return operation()
      })
      pending.add(task)
      void task.then(() => pending.delete(task), () => pending.delete(task))
      return task
    }
    const auth = new AuthClient({
      url: `${env.supabaseUrl.replace(/\/$/, '')}/auth/v1`,
      headers: { apikey: env.supabasePublishableKey },
      storageKey,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      skipAutoInitialize: true,
      lock: localLock,
      fetch: createAuthFetch(env.supabaseUrl),
    })
    try {
      const initialized = await auth.initialize()
      if (initialized.error) throw initialized.error
      const current = await auth.getSession()
      if (current.error) throw current.error
      const session = current.data.session
      // Exact tokens deliberately reject a refresh as well as A → B → A.
      // Retry from the updated UI; never infer that a matching user ID is enough.
      if (!isCurrent() || !session || session.user.id !== expected.user.id ||
          session.access_token !== expected.access_token || session.refresh_token !== expected.refresh_token) return changed
      const { error } = await auth.signOut()
      const after = await auth.getSession()
      return { localSignedOut: !after.error && after.data.session === null, remoteRevoked: !error, sessionChanged: false }
    } finally {
      closed = true
      await auth.dispose()
      while (pending.size > 0) await Promise.allSettled([...pending])
    }
  })
}
