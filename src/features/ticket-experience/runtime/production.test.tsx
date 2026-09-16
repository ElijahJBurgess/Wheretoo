import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  collection: vi.fn(), scanner: vi.fn(), camera: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}))
vi.mock('../customer/TicketCollectionPage', () => ({ TicketCollectionPage: mocks.collection }))
vi.mock('../scanner/OrganizerScannerPage', () => ({ OrganizerScannerPage: mocks.scanner }))
vi.mock('../scanner/cameraDecoder', () => ({ createCameraDecoder: mocks.camera }))
import { NotEnabledRoute, productionTicketExperienceRuntime as runtime } from './production'

describe('production ticket experience composition', () => {
  beforeEach(() => vi.clearAllMocks())
  it('loads the real collection only on entry, with a stable reader and unavailable Wallet', async () => {
    const Route = runtime.TicketCollectionRoute
    const view = render(<Route />)
    expect(screen.getByText('Loading tickets')).toBeVisible()
    await waitFor(() => expect(mocks.collection).toHaveBeenCalled())
    const first = mocks.collection.mock.calls[0]![0]
    view.rerender(<Route />)
    expect(mocks.collection.mock.calls[1]![0].reader).toBe(first.reader)
    expect(first.reader.readCollection).toBeTypeOf('function')
    expect(first.walletProvider.getCapability()).toEqual({ kind: 'unavailable', label: 'Add to Wallet — Coming later' })
  })
  it('loads the real scanner with a stable checker and actual camera factory', async () => {
    const Route = runtime.OrganizerScannerRoute
    const view = render(<Route />)
    expect(screen.getByText('Loading scanner')).toBeVisible()
    await waitFor(() => expect(screen.queryByText('Loading scanner')).not.toBeInTheDocument())
    const first = mocks.scanner.mock.calls[0]![0]
    view.rerender(<Route />)
    expect(mocks.scanner.mock.calls[1]![0].admissionChecker).toBe(first.admissionChecker)
    expect(first.admissionChecker.checkAdmission).toBeTypeOf('function')
    expect(first.cameraDecoder).toBe(mocks.camera.mock.results[0]!.value)
    expect(mocks.camera).toHaveBeenCalledTimes(1)
    expect(runtime.OrganizerDashboardRoute).not.toBe(NotEnabledRoute)
    expect(runtime.developmentRoutes).toEqual([])
  })
})
