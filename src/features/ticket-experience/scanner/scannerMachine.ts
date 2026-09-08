import type { AdmissionCheckResult } from '../contracts/admission'

export type CameraStartFailure = 'permission_denied' | 'no_camera' | 'initialization_failed'

export type CameraStartResult =
  | { kind: 'ready' }
  | { kind: CameraStartFailure }

export interface CameraDecoder {
  start(input: {
    element: HTMLVideoElement
    onDecode(value: string): void
    signal: AbortSignal
  }): Promise<CameraStartResult>
  stop(): void
}

export type ScannerState =
  | { kind: 'initializing' }
  | { kind: 'ready' }
  | { kind: 'checking'; credential: string }
  | { kind: 'result'; credential: string; result: AdmissionCheckResult }
  | { kind: CameraStartFailure }

export type ScannerAction =
  | { type: 'camera_started' }
  | { type: 'camera_failed'; failure: CameraStartFailure }
  | { type: 'decoded'; credential: string }
  | { type: 'check_resolved'; result: AdmissionCheckResult }
  | { type: 'retry_check' }
  | { type: 'scan_next' }
  | { type: 'return_to_scan' }

export const initialScannerState: ScannerState = { kind: 'initializing' }

export function reduceScanner(state: ScannerState, action: ScannerAction): ScannerState {
  if (state.kind === 'initializing' && action.type === 'camera_started') return { kind: 'ready' }
  if (state.kind === 'initializing' && action.type === 'camera_failed') return { kind: action.failure }
  if (state.kind === 'ready' && action.type === 'decoded') {
    return { kind: 'checking', credential: action.credential }
  }
  if (state.kind === 'checking' && action.type === 'check_resolved') {
    return { kind: 'result', credential: state.credential, result: action.result }
  }
  if (
    state.kind === 'result'
    && state.result.outcome === 'network_error'
    && action.type === 'retry_check'
  ) {
    return { kind: 'checking', credential: state.credential }
  }
  if (action.type === 'scan_next' || action.type === 'return_to_scan') {
    return { kind: 'initializing' }
  }
  return state
}
