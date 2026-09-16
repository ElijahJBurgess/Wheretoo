import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type RefObject } from 'react'
import { useParams } from 'react-router-dom'
import type { AdmissionChecker } from '../contracts/admission'
import {
  initialScannerState,
  reduceScanner,
  type CameraDecoder,
  type ScannerState,
} from './scannerMachine'

export type OrganizerScannerPageProps = {
  admissionChecker: AdmissionChecker
  cameraDecoder: CameraDecoder
  operational?: boolean
  onReset?(): void
}

export type ScannerController = {
  state: ScannerState
  videoRef: RefObject<HTMLVideoElement | null>
  submitDecoded(credential: string): void
  retryCheck(): void
  scanNext(): void
  returnToScan(): void
  retryCamera(): void
}

export function useScannerController({
  admissionChecker,
  cameraDecoder,
  onReset,
}: OrganizerScannerPageProps): ScannerController {
  const { eventId } = useParams()
  const [state, dispatch] = useReducer(reduceScanner, initialScannerState)
  const [cameraCycle, setCameraCycle] = useState(0)
  const stateRef = useRef(state)
  const decodeAcceptedRef = useRef(false)
  const latestDecoderRef = useRef(cameraDecoder)
  const activeDecoderRef = useRef<CameraDecoder | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    latestDecoderRef.current = cameraDecoder
  }, [cameraDecoder])

  const submitDecoded = useCallback((credential: string) => {
    if (stateRef.current.kind !== 'ready' || decodeAcceptedRef.current) return
    decodeAcceptedRef.current = true
    activeDecoderRef.current?.stop()
    dispatch({ type: 'decoded', credential })
  }, [])

  useEffect(() => {
    const element = videoRef.current
    const decoder = latestDecoderRef.current
    const abortController = new AbortController()
    let mounted = true
    decodeAcceptedRef.current = false
    activeDecoderRef.current = decoder

    if (!element) {
      dispatch({ type: 'camera_failed', failure: 'initialization_failed' })
      return () => { abortController.abort() }
    }

    void decoder.start({
      element,
      onDecode: submitDecoded,
      signal: abortController.signal,
    }).then((result) => {
      if (!mounted || abortController.signal.aborted) return
      if (result.kind === 'ready') dispatch({ type: 'camera_started' })
      else dispatch({ type: 'camera_failed', failure: result.kind })
    })

    return () => {
      mounted = false
      abortController.abort()
      decoder.stop()
      if (activeDecoderRef.current === decoder) activeDecoderRef.current = null
    }
  }, [cameraCycle, submitDecoded])

  useEffect(() => {
    if (state.kind !== 'checking') return

    const abortController = new AbortController()
    let mounted = true
    const credential = state.credential

    if (!eventId) {
      dispatch({ type: 'check_resolved', result: { outcome: 'network_error' } })
      return () => { abortController.abort() }
    }

    void admissionChecker.checkAdmission({
      eventId,
      credential,
      signal: abortController.signal,
    }).then(
      (result) => {
        if (mounted && !abortController.signal.aborted) {
          dispatch({ type: 'check_resolved', result })
        }
      },
      () => {
        if (mounted && !abortController.signal.aborted) {
          dispatch({ type: 'check_resolved', result: { outcome: 'network_error' } })
        }
      },
    )

    return () => {
      mounted = false
      abortController.abort()
    }
  }, [admissionChecker, eventId, state])

  const restartCamera = useCallback(() => {
    onReset?.()
    dispatch({ type: 'return_to_scan' })
    setCameraCycle((cycle) => cycle + 1)
  }, [onReset])

  const scanNext = useCallback(() => {
    onReset?.()
    dispatch({ type: 'scan_next' })
    setCameraCycle((cycle) => cycle + 1)
  }, [onReset])

  return {
    state,
    videoRef,
    submitDecoded,
    retryCheck: () => dispatch({ type: 'retry_check' }),
    scanNext,
    returnToScan: restartCamera,
    retryCamera: restartCamera,
  }
}
