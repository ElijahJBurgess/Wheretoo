import { describe, expect, it, vi } from 'vitest'
import { createCameraDecoder, type CameraDecoderDependencies } from './cameraDecoder'

function dependencies(overrides: Partial<CameraDecoderDependencies> = {}): CameraDecoderDependencies {
  return {
    listVideoInputDevices: vi.fn().mockResolvedValue([{ deviceId: 'camera-back' }]),
    decodeFromVideoDevice: vi.fn().mockResolvedValue({ stop: vi.fn() }),
    ...overrides,
  }
}

function startInput() {
  return {
    element: document.createElement('video'),
    onDecode: vi.fn(),
    signal: new AbortController().signal,
  }
}

describe('createCameraDecoder', () => {
  it('starts the first enumerated camera and forwards only decoded text', async () => {
    let callback: CameraDecoderDependencies['decodeFromVideoDevice'] extends (
      deviceId: string | undefined,
      element: HTMLVideoElement,
      callback: infer Callback,
    ) => Promise<unknown> ? Callback : never
    const controls = { stop: vi.fn() }
    const deps = dependencies({
      decodeFromVideoDevice: vi.fn(async (_deviceId, _element, onResult) => {
        callback = onResult
        return controls
      }),
    })
    const decoder = createCameraDecoder(deps)
    const input = startInput()

    await expect(decoder.start(input)).resolves.toEqual({ kind: 'ready' })
    expect(deps.decodeFromVideoDevice).toHaveBeenCalledWith('camera-back', input.element, expect.any(Function))
    callback!({ getText: () => 'opaque-admission-value' })
    callback!(undefined)
    expect(input.onDecode).toHaveBeenCalledExactlyOnceWith('opaque-admission-value')

    decoder.stop()
    expect(controls.stop).toHaveBeenCalledOnce()
  })

  it('fails closed when no camera is available', async () => {
    const deps = dependencies({ listVideoInputDevices: vi.fn().mockResolvedValue([]) })

    await expect(createCameraDecoder(deps).start(startInput())).resolves.toEqual({ kind: 'no_camera' })
    expect(deps.decodeFromVideoDevice).not.toHaveBeenCalled()
  })

  it('maps denied camera permission without exposing the provider error', async () => {
    const denied = Object.assign(new Error('private device detail'), { name: 'NotAllowedError' })
    const deps = dependencies({ listVideoInputDevices: vi.fn().mockRejectedValue(denied) })

    await expect(createCameraDecoder(deps).start(startInput())).resolves.toEqual({
      kind: 'permission_denied',
    })
  })

  it('maps all other initialization failures to a sanitized state', async () => {
    const deps = dependencies({
      decodeFromVideoDevice: vi.fn().mockRejectedValue(new Error('camera serial 123')),
    })

    await expect(createCameraDecoder(deps).start(startInput())).resolves.toEqual({
      kind: 'initialization_failed',
    })
  })

  it('stops controls acquired after an abort and ignores later results', async () => {
    let resolveControls!: (controls: { stop(): void }) => void
    let callback!: (result: { getText(): string } | undefined) => void
    const controls = { stop: vi.fn() }
    const deps = dependencies({
      decodeFromVideoDevice: vi.fn((_deviceId, _element, onResult) => {
        callback = onResult
        return new Promise<{ stop(): void }>((resolve) => { resolveControls = resolve })
      }),
    })
    const abortController = new AbortController()
    const input = { ...startInput(), signal: abortController.signal }
    const pending = createCameraDecoder(deps)
    const result = pending.start(input)

    await Promise.resolve()
    abortController.abort()
    resolveControls(controls)
    await expect(result).resolves.toEqual({ kind: 'initialization_failed' })
    callback({ getText: () => 'must-not-forward' })
    expect(controls.stop).toHaveBeenCalledOnce()
    expect(input.onDecode).not.toHaveBeenCalled()
  })

  it('honors a stop requested by a decode before startup retains its controls', async () => {
    const controls = { stop: vi.fn() }
    const deps = dependencies({
      decodeFromVideoDevice: vi.fn(async (_deviceId, _element, onResult) => {
        onResult({ getText: () => 'opaque-admission-value' })
        return controls
      }),
    })
    const decoder = createCameraDecoder(deps)

    await expect(decoder.start({
      ...startInput(),
      onDecode: () => decoder.stop(),
    })).resolves.toEqual({ kind: 'ready' })

    expect(controls.stop).toHaveBeenCalledOnce()
  })
})

it('stops every attached media track immediately and after late initialization', async () => {
  const stopVideo = vi.fn()
  const stopAudio = vi.fn()
  const input = startInput()
  let finish!: (controls: { stop(): void }) => void
  const decoder = createCameraDecoder(dependencies({ decodeFromVideoDevice: vi.fn((_id, element) => {
    element.srcObject = { getTracks: () => [{ stop: stopVideo }, { stop: stopAudio }] } as unknown as MediaStream
    return new Promise<{ stop(): void }>(resolve => { finish = resolve })
  }) }))
  const pending = decoder.start(input)
  await Promise.resolve()
  decoder.stop()
  expect(stopVideo).toHaveBeenCalled()
  expect(stopAudio).toHaveBeenCalled()
  expect(input.element.srcObject).toBeNull()
  const stopLate = vi.fn()
  input.element.srcObject = { getTracks: () => [{ stop: stopLate }] } as unknown as MediaStream
  const controls = { stop: vi.fn() }
  finish(controls)
  await pending
  expect(stopLate).toHaveBeenCalled()
  expect(controls.stop).toHaveBeenCalledOnce()
})
