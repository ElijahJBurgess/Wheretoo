import { describe, expect, it } from 'vitest'
import type { ScannerState } from './scannerMachine'
import { initialScannerState, reduceScanner } from './scannerMachine'

describe('reduceScanner', () => {
  it('enters ready only after camera initialization succeeds', () => {
    expect(reduceScanner(initialScannerState, { type: 'camera_started' })).toEqual({ kind: 'ready' })
  })

  it.each(['permission_denied', 'no_camera', 'initialization_failed'] as const)(
    'preserves the typed %s camera failure',
    (failure) => {
      expect(reduceScanner(initialScannerState, { type: 'camera_failed', failure })).toEqual({ kind: failure })
    },
  )

  it('retains exactly the network-failed credential for retry', () => {
    const checking = reduceScanner(
      { kind: 'ready' },
      { type: 'decoded', credential: 'wh_test_admit_network' },
    )
    const result = reduceScanner(checking, {
      type: 'check_resolved',
      result: { outcome: 'network_error' },
    })

    expect(reduceScanner(result, { type: 'retry_check' })).toEqual({
      kind: 'checking',
      credential: 'wh_test_admit_network',
    })
  })

  it('ignores every repeated decode outside ready', () => {
    const states: ScannerState[] = [
      { kind: 'initializing' },
      { kind: 'checking', credential: 'wh_test_admit_paid_valid' },
      {
        kind: 'result',
        credential: 'wh_test_admit_paid_valid',
        result: { outcome: 'admitted' },
      },
      { kind: 'permission_denied' },
      { kind: 'no_camera' },
      { kind: 'initialization_failed' },
    ]

    for (const state of states) {
      expect(reduceScanner(state, { type: 'decoded', credential: 'different' })).toBe(state)
    }
  })

  it('retains the scanned credential when a check resolves', () => {
    expect(reduceScanner(
      { kind: 'checking', credential: 'opaque-admission-value' },
      { type: 'check_resolved', result: { outcome: 'refunded' } },
    )).toEqual({
      kind: 'result',
      credential: 'opaque-admission-value',
      result: { outcome: 'refunded' },
    })
  })

  it.each(['scan_next', 'return_to_scan'] as const)(
    'clears credential state for %s',
    (type) => {
      expect(reduceScanner({
        kind: 'result',
        credential: 'opaque-admission-value',
        result: { outcome: 'invalid' },
      }, { type })).toEqual({ kind: 'initializing' })
    },
  )

  it('never turns a network error into an admitted result', () => {
    const state: ScannerState = {
      kind: 'result',
      credential: 'opaque-admission-value',
      result: { outcome: 'network_error' },
    }

    expect(reduceScanner(state, { type: 'camera_started' })).toBe(state)
  })
})
