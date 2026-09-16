import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const url = 'https://connect-js.stripe.com/v1.0/connect.js'
const script = () => document.querySelector<HTMLScriptElement>(`script[src="${url}"]`)!
const ready = () => vi.stubGlobal('StripeConnect', { init: vi.fn() })

async function loader() {
  return (await import('./connectScriptLoader')).loadConnectScript
}

describe('Connect script readiness', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers() })
  afterEach(() => {
    script()?.dispatchEvent(new Event('error'))
    document.querySelectorAll(`script[src="${url}"]`).forEach((node) => node.remove())
    vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks()
  })

  it('uses the public ready global without adding a script', async () => {
    ready()
    await expect((await loader())()).resolves.toBeUndefined()
    expect(script()).toBeNull()
  })

  it('shares one pending script and resolves only after load with public init present', async () => {
    const load = await loader(); const first = load(); const second = load()
    expect(document.querySelectorAll(`script[src="${url}"]`)).toHaveLength(1)
    expect(script().async).toBe(true)
    const remove = vi.spyOn(script(), 'removeEventListener')
    ready(); script().dispatchEvent(new Event('load'))
    await expect(first).resolves.toBeUndefined(); await expect(second).resolves.toBeUndefined()
    expect(remove.mock.calls.map(([type]) => type)).toEqual(['load', 'error'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['error', 'load'])('rejects %s without a ready global, removes only its failed tag, and permits retry', async (event) => {
    const load = await loader(); const first = load(); const rejected = expect(first).rejects.toThrow(/Stripe/)
    const failed = script(); failed.dispatchEvent(new Event(event)); await rejected
    expect(failed.isConnected).toBe(false)
    const retry = load(); expect(script()).not.toBe(failed)
    ready(); script().dispatchEvent(new Event('load')); await expect(retry).resolves.toBeUndefined()
  })

  it('bounds waits without duplicating an uncertain script and handles its eventual readiness', async () => {
    const load = await loader(); const first = load(); const rejected = expect(first).rejects.toThrow(/timed out/)
    const pending = script(); const add = vi.spyOn(pending, 'addEventListener')
    await vi.advanceTimersByTimeAsync(25_000); await rejected
    const retry = load(); expect(script()).toBe(pending); expect(add).not.toHaveBeenCalled()
    ready(); pending.dispatchEvent(new Event('load')); await expect(retry).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not treat a malformed global as readiness', async () => {
    vi.stubGlobal('StripeConnect', { init: 'unavailable' })
    const load = await loader(); const waiting = load(); const rejected = expect(waiting).rejects.toThrow(/initializer/)
    script().dispatchEvent(new Event('load')); await rejected
  })

  it('cleans the shared transport listeners after repeated timeouts and a late error', async () => {
    const load = await loader(); const first = load(); const firstFailure = expect(first).rejects.toThrow(/timed out/)
    const pending = script(); const remove = vi.spyOn(pending, 'removeEventListener')
    await vi.advanceTimersByTimeAsync(25_000); await firstFailure
    const second = load(); const secondFailure = expect(second).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(25_000); await secondFailure
    expect(vi.getTimerCount()).toBe(0)
    pending.dispatchEvent(new Event('error'))
    expect(remove).toHaveBeenCalledTimes(2); expect(pending.isConnected).toBe(false)
    const retry = load(); ready(); script().dispatchEvent(new Event('load'))
    await expect(retry).resolves.toBeUndefined()
  })

  it('settles pending waiters when a later consumer observes an already-ready global', async () => {
    const load = await loader(); const first = load(); const remove = vi.spyOn(script(), 'removeEventListener')
    ready(); await load(); await expect(first).resolves.toBeUndefined()
    expect(remove).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0)
  })

  it('observes a foreign script but never removes or replaces it after failure', async () => {
    const foreign = document.createElement('script'); foreign.src = url; document.head.append(foreign)
    const load = await loader(); const first = load(); const rejected = expect(first).rejects.toThrow(/Stripe/)
    foreign.dispatchEvent(new Event('error')); await rejected
    expect(foreign.isConnected).toBe(true)
    const retry = load(); const timedOut = expect(retry).rejects.toThrow(/timed out/)
    expect(document.querySelectorAll(`script[src="${url}"]`)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(25_000); await timedOut
  })
})
