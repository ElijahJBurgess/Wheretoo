import { createClient, type Session } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIsolatedAccountClient } from './isolatedAccountClient'
function jwt(sub: string) {
  const encode = (value: string) => btoa(value).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${encode(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }))}.${encode(crypto.randomUUID())}`
}
function user(id: string) { return { id, aud: 'authenticated', role: 'authenticated', email: `${id}@example.com`, app_metadata: {}, user_metadata: {}, created_at: '2026-09-01T00:00:00Z' } }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('isolated Auth SDK writes', () => {
  it('refuses an expiring captured session instead of rotating the shared refresh token in isolation', async () => {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify(user('a')), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchStub)
    const session = { access_token: jwt('a'), refresh_token: crypto.randomUUID(), user: user('a'), expires_at: Math.floor(Date.now() / 1000), expires_in: 0, token_type: 'bearer' } as Session
    await expect(createIsolatedAccountClient(session)).rejects.toMatchObject({ name: 'AuthSessionMissingError' })
    expect(fetchStub).not.toHaveBeenCalled()
  })


  it('never forwards a refresh token when elapsed request time enters the SDK refresh margin', async () => {
    const now = Date.now()
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).includes('/token') ? { error_code: 'session_not_found' } : user('a')), { status: String(input).includes('/token') ? 401 : 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchStub)
    const isolated = await createIsolatedAccountClient({ access_token: jwt('a'), refresh_token: crypto.randomUUID(), user: user('a'), expires_at: Math.floor(now / 1000) + 3600, expires_in: 3600, token_type: 'bearer' })
    try {
      vi.spyOn(Date, 'now').mockReturnValue(now + 3540_000)
      const result = await isolated.auth.getUser()
      expect(result.error?.name).toBe('AuthSessionMissingError')
      expect(fetchStub.mock.calls.filter(([input]) => String(input).includes('/token'))).toHaveLength(0)
    } finally { await isolated.auth.dispose() }
  })

  it('a late A updateUser completion cannot replace the main B session or its storage', async () => {
    const tokenA = jwt('a'), tokenB = jwt('b')
    let finish!: () => void
    const fetchStub = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const id = headers.get('Authorization')?.includes(tokenB) ? 'b' : 'a'
      if (init?.method === 'PUT') await new Promise<void>(resolve => { finish = resolve })
      return new Response(JSON.stringify(user(id)), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchStub)
    const storage = new Map<string, string>()
    const main = createClient('http://127.0.0.1:9', 'sb_publishable_spec11_fixture', { auth: { autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'spec11-main', storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value) }, removeItem: key => { storage.delete(key) } } } })
    const start = await main.auth.setSession({ access_token: tokenA, refresh_token: crypto.randomUUID() })
    expect(start.error?.message ?? null).toBeNull()
    const isolated = await createIsolatedAccountClient(start.data.session as Session)
    const pending = isolated.auth.updateUser({ data: { full_name: 'Updated A' } })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await main.auth.setSession({ access_token: tokenB, refresh_token: crypto.randomUUID() })
    finish()
    await pending
    expect((await main.auth.getSession()).data.session?.user.id).toBe('b')
    expect(JSON.parse(storage.get('spec11-main')!).user.id).toBe('b')
    expect(storage.size).toBe(1)
    await main.auth.dispose()
    await isolated.auth.dispose()
  })
})
