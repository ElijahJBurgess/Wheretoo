/* eslint-disable react-hooks/refs -- the test harness renders the public controller contract */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AdmissionChecker } from '../contracts/admission'
import type { CameraDecoder } from './scannerMachine'
import { useScannerController } from './useScannerController'

function fakeCamera(result: Awaited<ReturnType<CameraDecoder['start']>> = { kind: 'ready' }) {
  let startInput: Parameters<CameraDecoder['start']>[0] | undefined
  const decoder: CameraDecoder = {
    start: vi.fn(async (input) => {
      startInput = input
      return result
    }),
    stop: vi.fn(),
  }
  return { decoder, get input() { return startInput } }
}

function Harness(props: { admissionChecker: AdmissionChecker; cameraDecoder: CameraDecoder }) {
  const controller = useScannerController(props)
  return (
    <>
      <video ref={controller.videoRef} />
      <output>{controller.state.kind}</output>
      <button type="button" onClick={controller.retryCheck}>Retry check-in</button>
      <button type="button" onClick={controller.scanNext}>Scan next</button>
    </>
  )
}

function renderHarness(admissionChecker: AdmissionChecker, cameraDecoder: CameraDecoder) {
  return render(
    <MemoryRouter initialEntries={['/organizer/events/event-a/check-in']}>
      <Routes>
        <Route
          path="/organizer/events/:eventId/check-in"
          element={<Harness admissionChecker={admissionChecker} cameraDecoder={cameraDecoder} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('useScannerController camera cycle', () => {
  it('starts once, stops synchronously on the first decode, and ignores repeated reads', async () => {
    const camera = fakeCamera()
    const checkAdmission = vi.fn<AdmissionChecker['checkAdmission']>().mockResolvedValue({ outcome: 'admitted' })
    renderHarness({ checkAdmission }, camera.decoder)

    expect(await screen.findByText('ready')).toBeVisible()
    expect(camera.decoder.start).toHaveBeenCalledOnce()

    act(() => {
      camera.input?.onDecode('first-opaque-value')
      camera.input?.onDecode('second-opaque-value')
    })

    expect(camera.decoder.stop).toHaveBeenCalledOnce()
    await waitFor(() => expect(checkAdmission).toHaveBeenCalledOnce())
    expect(checkAdmission).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'event-a',
      credential: 'first-opaque-value',
    }))
    expect(await screen.findByText('result')).toBeVisible()
  })

  it.each([
    ['permission_denied', 'permission_denied'],
    ['no_camera', 'no_camera'],
    ['initialization_failed', 'initialization_failed'],
  ] as const)('retains a %s camera failure', async (_label, kind) => {
    const camera = fakeCamera({ kind })
    renderHarness({ checkAdmission: vi.fn() }, camera.decoder)

    expect(await screen.findByText(kind)).toBeVisible()
  })

  it('aborts initialization and stops the decoder on unmount', async () => {
    const camera = fakeCamera()
    const view = renderHarness({ checkAdmission: vi.fn() }, camera.decoder)
    expect(await screen.findByText('ready')).toBeVisible()
    const signal = camera.input?.signal

    view.unmount()

    expect(signal?.aborted).toBe(true)
    expect(camera.decoder.stop).toHaveBeenCalled()
  })

  it('does not start a replacement decoder outside initializing', async () => {
    const firstCamera = fakeCamera()
    const secondCamera = fakeCamera()
    const checker: AdmissionChecker = { checkAdmission: vi.fn(() => new Promise<never>(() => {})) }
    const route = (cameraDecoder: CameraDecoder) => (
      <MemoryRouter initialEntries={['/organizer/events/event-a/check-in']}>
        <Routes>
          <Route
            path="/organizer/events/:eventId/check-in"
            element={<Harness admissionChecker={checker} cameraDecoder={cameraDecoder} />}
          />
        </Routes>
      </MemoryRouter>
    )
    const view = render(route(firstCamera.decoder))
    expect(await screen.findByText('ready')).toBeVisible()
    act(() => firstCamera.input?.onDecode('opaque-value'))
    expect(await screen.findByText('checking')).toBeVisible()

    view.rerender(route(secondCamera.decoder))
    await Promise.resolve()

    expect(secondCamera.decoder.start).not.toHaveBeenCalled()
  })
})

describe('useScannerController admission cycle', () => {
  it('resends the exact in-memory credential after a network error without restarting the camera', async () => {
    const user = userEvent.setup()
    const camera = fakeCamera()
    const checkAdmission = vi
      .fn<AdmissionChecker['checkAdmission']>()
      .mockResolvedValueOnce({ outcome: 'network_error' })
      .mockResolvedValueOnce({ outcome: 'admitted' })
    renderHarness({ checkAdmission }, camera.decoder)
    expect(await screen.findByText('ready')).toBeVisible()

    act(() => camera.input?.onDecode('exact-opaque-value'))
    expect(await screen.findByText('result')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry check-in' }))
    expect(await screen.findByText('result')).toBeVisible()

    expect(checkAdmission).toHaveBeenCalledTimes(2)
    expect(checkAdmission.mock.calls.map(([input]) => input.credential)).toEqual([
      'exact-opaque-value',
      'exact-opaque-value',
    ])
    expect(camera.decoder.start).toHaveBeenCalledOnce()
  })

  it('starts a fresh camera initialization only after scan next', async () => {
    const user = userEvent.setup()
    const camera = fakeCamera()
    const checkAdmission = vi.fn<AdmissionChecker['checkAdmission']>().mockResolvedValue({ outcome: 'invalid' })
    renderHarness({ checkAdmission }, camera.decoder)
    expect(await screen.findByText('ready')).toBeVisible()
    act(() => camera.input?.onDecode('opaque-value'))
    expect(await screen.findByText('result')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Scan next' }))

    expect(await screen.findByText('ready')).toBeVisible()
    expect(camera.decoder.start).toHaveBeenCalledTimes(2)
  })

  it('maps checker rejection to network error without manufacturing admission', async () => {
    const camera = fakeCamera()
    const checkAdmission = vi.fn<AdmissionChecker['checkAdmission']>().mockRejectedValue(new Error('raw provider response'))
    renderHarness({ checkAdmission }, camera.decoder)
    expect(await screen.findByText('ready')).toBeVisible()
    act(() => camera.input?.onDecode('opaque-value'))

    expect(await screen.findByText('result')).toBeVisible()
  })
})
