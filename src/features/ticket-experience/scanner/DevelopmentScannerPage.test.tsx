import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AdmissionChecker } from '../contracts/admission'
import type { CameraDecoder } from './scannerMachine'
import { DevelopmentScannerPage } from './DevelopmentScannerPage'

function renderDevelopmentPage() {
  const checkAdmission = vi.fn<AdmissionChecker['checkAdmission']>().mockResolvedValue({
    outcome: 'admitted',
    admissionLabel: 'Free RSVP',
  })
  const cameraDecoder: CameraDecoder = {
    start: vi.fn().mockResolvedValue({ kind: 'ready' }),
    stop: vi.fn(),
  }
  render(
    <MemoryRouter initialEntries={['/__dev/ticket-shells/events/event-a/check-in']}>
      <Routes>
        <Route
          path="/__dev/ticket-shells/events/:eventId/check-in"
          element={<DevelopmentScannerPage admissionChecker={{ checkAdmission }} cameraDecoder={cameraDecoder} />}
        />
      </Routes>
    </MemoryRouter>,
  )
  return { checkAdmission }
}

describe('DevelopmentScannerPage', () => {
  it('submits a visibly development-only fake credential through the same controller', async () => {
    const user = userEvent.setup()
    const { checkAdmission } = renderDevelopmentPage()
    expect(await screen.findByText('Ready to scan')).toBeVisible()

    expect(screen.getByText('Development only')).toBeVisible()
    await user.type(screen.getByLabelText('Fake admission credential'), 'wh_test_admit_rsvp_valid')
    await user.click(screen.getByRole('button', { name: 'Submit fake credential' }))

    expect(await screen.findByRole('heading', { name: 'Admitted' })).toBeVisible()
    expect(checkAdmission).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'event-a',
      credential: 'wh_test_admit_rsvp_valid',
    }))
  })

  it('does not echo the submitted credential into the result UI', async () => {
    const user = userEvent.setup()
    renderDevelopmentPage()
    expect(await screen.findByText('Ready to scan')).toBeVisible()
    const input = screen.getByLabelText('Fake admission credential')
    await user.type(input, 'private-test-credential')
    await user.click(screen.getByRole('button', { name: 'Submit fake credential' }))

    expect(await screen.findByRole('heading', { name: 'Admitted' })).toBeVisible()
    expect(screen.queryByDisplayValue('private-test-credential')).not.toBeInTheDocument()
    expect(screen.queryByText('private-test-credential')).not.toBeInTheDocument()
  })
})
