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
  let controls: ScannerControls | undefined
  let stopRequested = false

  return {
    async start(input) {
      stopRequested = false
      try {
        const devices = await dependencies.listVideoInputDevices()
        if (input.signal.aborted) return { kind: 'initialization_failed' }
        if (devices.length === 0) return { kind: 'no_camera' }

        const nextControls = await dependencies.decodeFromVideoDevice(
          devices[0]?.deviceId,
          input.element,
          (result) => {
            if (result && !input.signal.aborted) input.onDecode(result.getText())
          },
        )

        if (input.signal.aborted || stopRequested) {
          nextControls.stop()
          stopRequested = false
          if (input.signal.aborted) return { kind: 'initialization_failed' }
          return { kind: 'ready' }
        }

        controls = nextControls
        return { kind: 'ready' }
      } catch (error) {
        return { kind: isPermissionDenied(error) ? 'permission_denied' : 'initialization_failed' }
      }
    },
    stop() {
      if (!controls) {
        stopRequested = true
        return
      }
      controls.stop()
      controls = undefined
      stopRequested = false
    },
  }
}
