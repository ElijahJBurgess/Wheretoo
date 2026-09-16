import { BrowserCodeReader, BrowserQRCodeReader } from '@zxing/browser'
import type { CameraDecoder } from './scannerMachine'

type ScannerControls = { stop(): void }
type DecodedResult = { getText(): string }

export type CameraDecoderDependencies = {
  listVideoInputDevices(): Promise<readonly { deviceId: string }[]>
  decodeFromVideoDevice(
    deviceId: string | undefined,
    element: HTMLVideoElement,
    onResult: (result: DecodedResult | undefined) => void,
  ): Promise<ScannerControls>
}

function isPermissionDenied(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'NotAllowedError'
}

function defaultDependencies(): CameraDecoderDependencies {
  const reader = new BrowserQRCodeReader()

  return {
    listVideoInputDevices: () => BrowserCodeReader.listVideoInputDevices(),
    decodeFromVideoDevice: (deviceId, element, onResult) => (
      reader.decodeFromVideoDevice(deviceId, element, (result) => onResult(result))
    ),
  }
}

export function createCameraDecoder(
  dependencies: CameraDecoderDependencies = defaultDependencies(),
): CameraDecoder {
  type CameraRun = { controls?: ScannerControls; stopped: boolean; element: HTMLVideoElement }
  let active: CameraRun | undefined
  function stopTracks(run: CameraRun) {
    const stream = run.element.srcObject
    if (stream && 'getTracks' in stream) {
      for (const track of stream.getTracks()) track.stop()
      run.element.srcObject = null
    }
  }
  function stopRun(run: CameraRun) {
    run.stopped = true
    run.controls?.stop()
    run.controls = undefined
    if (active === run) stopTracks(run)
  }

  return {
    async start(input) {
      if (active) stopRun(active)
      const run: CameraRun = { stopped: false, element: input.element }
      active = run
      const abort = () => stopRun(run)
      input.signal.addEventListener('abort', abort, { once: true })
      try {
        const devices = await dependencies.listVideoInputDevices()
        if (input.signal.aborted || run.stopped) return { kind: 'initialization_failed' }
        if (devices.length === 0) return { kind: 'no_camera' }
        const nextControls = await dependencies.decodeFromVideoDevice(
          devices[0]?.deviceId,
          input.element,
          (result) => {
            if (result && !input.signal.aborted && !run.stopped && active === run) input.onDecode(result.getText())
          },
        )
        run.controls = nextControls
        if (input.signal.aborted || run.stopped || active !== run) {
          stopRun(run)
          return { kind: input.signal.aborted ? 'initialization_failed' : 'ready' }
        }
        return { kind: 'ready' }
      } catch (error) {
        stopRun(run)
        return { kind: isPermissionDenied(error) ? 'permission_denied' : 'initialization_failed' }
      } finally {
        // Controller unmount also calls stop; retain abort cleanup while controls are active.
        if (!run.controls) input.signal.removeEventListener('abort', abort)
      }
    },
    stop() {
      if (active) stopRun(active)
    },
  }
}
