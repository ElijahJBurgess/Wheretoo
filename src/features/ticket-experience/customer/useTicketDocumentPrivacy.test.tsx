import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { developmentTicketExperienceRuntime } from '../runtime/development'
import { productionTicketExperienceRuntime } from '../runtime/production'
import { useTicketDocumentPrivacy } from './useTicketDocumentPrivacy'

vi.mock('qrcode.react', () => ({
  QRCodeCanvas: () => <canvas aria-label="Admission QR code" />,
}))

function PrivacyProbe() {
  useTicketDocumentPrivacy()
  return <span>Private ticket page</span>
}

afterEach(() => {
  document.head.querySelector('meta[name="referrer"]')?.remove()
})

describe('useTicketDocumentPrivacy', () => {
  it('installs no-referrer and removes a meta element it created', () => {
    const view = render(<PrivacyProbe />)

    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')

    view.unmount()
    expect(document.head.querySelector('meta[name="referrer"]')).toBeNull()
  })

  it('restores the content of a pre-existing referrer policy', () => {
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'strict-origin'
    document.head.append(meta)

    const view = render(<PrivacyProbe />)
    expect(meta).toHaveAttribute('content', 'no-referrer')

    view.unmount()
    expect(meta).toHaveAttribute('content', 'strict-origin')
  })

  it('protects the real production unavailable ticket route', async () => {
    const TicketCollectionRoute = productionTicketExperienceRuntime.TicketCollectionRoute

    render(
      <MemoryRouter initialEntries={['/tickets/malformed-synthetic-bearer']}>
        <Routes>
          <Route path="/tickets/:collectionBearer" element={<TicketCollectionRoute />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Tickets unavailable')).toBeVisible()
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  })

  it('protects the development ticket experience route', async () => {
    const TicketCollectionRoute = developmentTicketExperienceRuntime.TicketCollectionRoute

    render(
      <MemoryRouter initialEntries={['/tickets/wh_test_collection_paid']}>
        <Routes>
          <Route path="/tickets/:collectionBearer" element={<TicketCollectionRoute />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Ticket 1' })).toBeVisible()
    expect(screen.getByTestId('admission-qr')).toBeVisible()
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  })
})
