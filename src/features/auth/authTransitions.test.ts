import { afterEach, describe, expect, it, vi } from 'vitest'
import { authTransitionLock, createAuthFetch } from './authTransitions'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('Auth transition boundaries', () => {
  it('fails closed without native coordination before a mutation can run', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    let mutated = false
    await expect(authTransitionLock('auth', 10, async () => { mutated = true })).rejects.toThrow(/browser/i)
    expect(mutated).toBe(false)
  })
  it('does not proceed when the browser returns no exclusive lock', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name: string, _options: unknown, fn: (lock: null) => Promise<unknown>) => fn(null) } })
    let mutated = false
    await expect(authTransitionLock('auth', 0, async () => { mutated = true })).rejects.toThrow(/in progress/i)
    expect(mutated).toBe(false)
  })
  it('settles a hung Auth request before a late provider response can be consumed', async () => {
    vi.useFakeTimers()
    let respond!: (response: Response) => void
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { respond = resolve }))
    const fetchAuth = createAuthFetch('https://auth.example.invalid', 30)
    const outcome = fetchAuth('https://auth.example.invalid/auth/v1/logout', {}).catch(error => error)
    await vi.advanceTimersByTimeAsync(31)
    expect(await outcome).toBeInstanceOf(Error)
    expect((await outcome).message).toMatch(/timed out/i)
    respond(new Response(null, { status: 204 }))
    await Promise.resolve()
    expect(await outcome).toBeInstanceOf(Error)
  })
  it('includes a stalled Auth response body in the deadline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ start() {} })))
    const result = createAuthFetch('https://auth.example.invalid', 30)('https://auth.example.invalid/auth/v1/token', {}).catch(error => error)
    await vi.advanceTimersByTimeAsync(31)
    expect((await result).message).toMatch(/timed out/i)
  })
  it('preserves a completed Auth response and does not time out unrelated application requests', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }))
    const response = await createAuthFetch('https://auth.example.invalid')('https://auth.example.invalid/auth/v1/token', {})
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    const external = new Response('application data')
    vi.stubGlobal('fetch', async () => external)
    expect(await createAuthFetch('https://auth.example.invalid')('https://auth.example.invalid/rest/v1/events', {})).toBe(external)
  })
})
