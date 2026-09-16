import { AuthClient, type Session } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
const { getSession, getUser } = vi.hoisted(() => ({ getSession: vi.fn(), getUser: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ supabase: { auth: { getSession, getUser } } }))
import { changeAccountPassword, getAccountIdentity, requestPasswordReauthentication } from './account.api'
import { createIsolatedAccountClient } from './isolatedAccountClient'
function session(owner = 'a'): Session {
  const encode = (value: string) => btoa(value).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const exp = Math.floor(Date.now() / 1000) + 3600
  return { access_token: `${encode(JSON.stringify({ alg: 'HS256' }))}.${encode(JSON.stringify({ sub: owner, exp }))}.${encode(crypto.randomUUID())}`, refresh_token: crypto.randomUUID(), expires_at: exp, expires_in: 3600, token_type: 'bearer', user: { id: owner, aud: 'authenticated', user_metadata: {}, app_metadata: {}, created_at: '2026-09-01T00:00:00Z', email: `${owner}@example.com` } }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('isolated account SDK disposal', () => {

  it('a delayed A fresh-read session_not_found response cannot remove the main B session', async () => {
    const a = session(), b = session('b')
    let finish!: () => void
    let deferA = false
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const ownerB = new Headers(init?.headers).get('Authorization')?.includes(b.access_token)
      if (!ownerB && deferA) {
        deferA = false
        await new Promise<void>(resolve => { finish = resolve })
        return new Response(JSON.stringify({ error_code: 'session_not_found', message: 'Expired fixture session' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify(ownerB ? b.user : a.user), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const storage = new Map<string, string>()
    const main = new AuthClient({ url: 'http://127.0.0.1:9/auth/v1', autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'spec11-read-main', storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value) }, removeItem: key => { storage.delete(key) } } })
    try {
      await main.setSession(a)
      getSession.mockImplementation(() => main.getSession())
      getUser.mockImplementation(() => main.getUser())
      deferA = true
      const pending = getAccountIdentity('a').catch(error => error)
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
      await main.setSession(b)
      finish()
      expect(await pending).toMatchObject({ code: 'session_expired' })
      expect((await main.getSession()).data.session?.user.id).toBe('b')
      expect(JSON.parse(storage.get('spec11-read-main')!).user.id).toBe('b')
    } finally { await main.dispose() }
  })

  it.each(['initialize-failure', 'fresh-read-failure', 'account-read-success', 'clock-expired-failure', 'update-success', 'update-failure', 'reauth-success', 'reauth-failure'] as const)('removes the SDK visibility listener after %s', async outcome => {
    const current = session()
    const startedAt = Date.now()
    getSession.mockResolvedValue({ data: { session: current }, error: null })
    let reads = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(_input)
      const reauth = url.includes('/reauthenticate')
      if (!reauth && init?.method !== 'PUT') reads += 1
      if (outcome === 'clock-expired-failure' && reads === 1) vi.spyOn(Date, 'now').mockReturnValue(startedAt + 3540_000)
      const fail = (outcome === 'initialize-failure' && reads === 1) || (outcome === 'fresh-read-failure' && reads === 2) || (outcome === 'update-failure' && init?.method === 'PUT') || (outcome === 'reauth-failure' && reauth)
      return new Response(JSON.stringify(fail ? { code: 'validation_failed', message: 'Rejected fixture' } : reauth ? {} : current.user), { status: fail ? 400 : 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    try {
      const operation = outcome === 'initialize-failure'
        ? createIsolatedAccountClient(current).then(client => client.auth.dispose())
        : outcome === 'account-read-success' ? getAccountIdentity('a') : outcome.startsWith('reauth') ? requestPasswordReauthentication('a') : changeAccountPassword('a', crypto.randomUUID())
      const result = await operation.then(() => 'success', () => 'failure')
      expect(result).toBe(outcome.endsWith('failure') ? 'failure' : 'success')
      if (outcome === 'clock-expired-failure') expect(reads).toBe(1)
      const callbacks = added.mock.calls.filter(([type]) => type === 'visibilitychange').map(([, callback]) => callback)
      expect(callbacks.length).toBeGreaterThan(0)
      for (const callback of callbacks) expect(removed.mock.calls.some(([type, handler]) => type === 'visibilitychange' && handler === callback)).toBe(true)
    } finally {
      for (const [type, callback] of added.mock.calls) if (type === 'visibilitychange') window.removeEventListener(type, callback)
    }
  })
})
