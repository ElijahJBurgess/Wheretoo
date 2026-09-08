import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AdmissionChecker, AdmissionOutcome } from '../contracts/admission'
import type { CameraDecoder, CameraStartFailure } from './scannerMachine'
import { OrganizerScannerPage } from './OrganizerScannerPage'

function cameraWith(result: { kind: 'ready' | CameraStartFailure } = { kind: 'ready' }) {
  let input: Parameters<CameraDecoder['start']>[0] | undefined
  const decoder: CameraDecoder = {
    start: vi.fn(async (value) => {
      input = value
      return result
    }),
    stop: vi.fn(),
  }
  return { decoder, get input() { return input } }
}

function renderPage(admissionChecker: AdmissionChecker, cameraDecoder: CameraDecoder) {
  return render(
    <MemoryRouter initialEntries={['/organizer/events/event-a/check-in']}>
      <Routes>
        <Route
          path="/organizer/events/:eventId/check-in"
          element={<OrganizerScannerPage admissionChecker={admissionChecker} cameraDecoder={cameraDecoder} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('OrganizerScannerPage scan cycle', () => {
  it.each([
    ['admitted', 'Admitted'],
    ['already_used', 'Already used'],
    ['refunded', 'Refunded'],
    ['cancelled', 'Cancelled'],
    ['wrong_event', 'Wrong event'],
    ['invalid', 'Invalid ticket'],
    ['network_error', 'Network error'],
  ] as const)('renders an immediate, stable %s result with text', async (outcome, heading) => {
    const camera = cameraWith()
    const checkAdmission = vi.fn<AdmissionChecker['checkAdmission']>().mockResolvedValue({
      outcome,
      admissionLabel: 'General Admission',
      attendeeLabel: 'Demo guest',
    })
    renderPage({ checkAdmission }, camera.decoder)
    expect(await screen.findByText('Ready to scan')).toBeVisible()

    act(() => camera.input?.onDecode(`opaque-${outcome}`))

    expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
    expect(screen.getByText('General Admission')).toBeVisible()
    expect(screen.getByText('Demo guest')).toBeVisible()
    expect(screen.queryByText(`opaque-${outcome}`)).not.toBeInTheDocument()
  })

  it.each([
    ['paid credential', 'General Admission'],
    ['free RSVP credential', 'Free RSVP'],
  ])('uses the same view tree for an admitted %s', async (_source, admissionLabel) => {
    const camera = cameraWith()
    const checkAdmission = vi.fn<AdmissionChecker['checkAdmission']>().mockResolvedValue({
      outcome: 'admitted',
      admissionLabel,
      attendeeLabel: 'Demo guest',
    })
    const view = renderPage({ checkAdmission }, camera.decoder)
    expect(await screen.findByText('Ready to scan')).toBeVisible()
    act(() => camera.input?.onDecode('opaque-value'))

    expect(await screen.findByRole('heading', { name: 'Admitted' })).toBeVisible()
    expect(view.container.querySelector('.organizer-scanner__result--admitted')).not.toBeNull()
  })

  it('shows checking without implying success while the adapter is pending', async () => {
    const camera = cameraWith()
    const checkAdmission = vi.fn<AdmissionChecker['checkAdmission']>(() => new Promise(() => {}))
    renderPage({ checkAdmission }, camera.decoder)
    expect(await screen.findByText('Ready to scan')).toBeVisible()

    act(() => camera.input?.onDecode('opaque-value'))

    expect(await screen.findByRole('heading', { name: 'Checking ticket' })).toBeVisible()
    expect(screen.queryByText('Admitted')).not.toBeInTheDocument()
  })

  it('offers retry and return actions for network error only', async () => {
    const camera = cameraWith()
    const checkAdmission = vi.fn<AdmissionChecker['checkAdmission']>().mockResolvedValue({ outcome: 'network_error' })
    renderPage({ checkAdmission }, camera.decoder)
    expect(await screen.findByText('Ready to scan')).toBeVisible()
    act(() => camera.input?.onDecode('opaque-value'))

    expect(await screen.findByRole('button', { name: 'Retry check-in' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Return to scanning' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Scan next ticket' })).not.toBeInTheDocument()
  })

  it.each([
    ['permission_denied', 'Camera permission denied'],
    ['no_camera', 'No camera available'],
    ['initialization_failed', 'Camera could not start'],
  ] as const)('renders %s recovery with explicit retry', async (kind, heading) => {
    const camera = cameraWith({ kind })
    renderPage({ checkAdmission: vi.fn() }, camera.decoder)

    expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry camera' })).toBeVisible()
  })

  it('does not render development credential controls', async () => {
    const camera = cameraWith()
    renderPage({ checkAdmission: vi.fn() }, camera.decoder)

    expect(await screen.findByText('Ready to scan')).toBeVisible()
    expect(screen.queryByText('Development only')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Fake admission credential')).not.toBeInTheDocument()
  })

  it('guards session feedback behind the mute control', async () => {
    const user = userEvent.setup()
    const vibrate = vi.fn()
    Object.defineProperty(window.navigator, 'vibrate', { configurable: true, value: vibrate })
    const camera = cameraWith()
    const outcomes: AdmissionOutcome[] = ['admitted']
    renderPage({
      checkAdmission: vi.fn(async () => ({ outcome: outcomes[0] })),
    }, camera.decoder)
    expect(await screen.findByText('Ready to scan')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Mute scanner feedback' }))

    act(() => camera.input?.onDecode('opaque-value'))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Admitted' })).toBeVisible())
    expect(vibrate).not.toHaveBeenCalled()
  })
})
