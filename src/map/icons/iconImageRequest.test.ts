import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadIconImage } from './iconImageRequest'

afterEach(() => vi.unstubAllGlobals())

describe('icon image transport', () => {
  it('aborts a stalled fetch without delivering a late callback', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signal = init.signal
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted'))))
    }))
    const callback = vi.fn()
    const cancel = loadIconImage('https://assets.example/icon.png', callback)
    cancel()
    expect(signal?.aborted).toBe(true)
    await Promise.resolve(); await Promise.resolve()
    expect(callback).not.toHaveBeenCalled()
  })

  it('closes a decode that finishes after cancellation', async () => {
    const image = { close: vi.fn(), width: 600, height: 922 }
    let decode!: (value: typeof image) => void
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'Content-Type': 'image/png' }), blob: async () => new Blob(['png']) })))
    const create = vi.fn(() => new Promise(resolve => { decode = resolve }))
    vi.stubGlobal('createImageBitmap', create)
    const callback = vi.fn(), cancel = loadIconImage('https://assets.example/icon.png', callback)
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
    cancel(); decode(image)
    await vi.waitFor(() => expect(image.close).toHaveBeenCalledOnce())
    expect(callback).not.toHaveBeenCalled()
  })

  it('delivers an approved PNG without credentials or redirect following', async () => {
    const image = { close: vi.fn(), width: 600, height: 922 }
    const fetchImage = vi.fn(async () => ({ ok: true, headers: new Headers({ 'Content-Type': 'image/png' }), blob: async () => new Blob(['png']) }))
    vi.stubGlobal('fetch', fetchImage); vi.stubGlobal('createImageBitmap', vi.fn(async () => image))
    const callback = vi.fn()
    loadIconImage('https://assets.example/icon.png', callback)
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(null, image))
    expect(fetchImage).toHaveBeenCalledWith('https://assets.example/icon.png', expect.objectContaining({ credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) }))
  })
})
