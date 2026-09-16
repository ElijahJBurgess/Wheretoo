import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TicketDisplay } from '../contracts/ticketCollection'
import type { WalletCapability } from '../contracts/wallet'
import { AdmissionQr } from './AdmissionQr'
import { FocusedTicketView } from './FocusedTicketView'

const qrCanvas = vi.hoisted(() => vi.fn())

vi.mock('qrcode.react', () => ({
  QRCodeCanvas: (props: Record<string, unknown>) => {
    qrCanvas(props)
    return <canvas aria-label="Admission QR code" />
  },
}))

const walletCapability: WalletCapability = {
  kind: 'unavailable',
  label: 'Add to Wallet — Coming later',
}

function ticket(overrides: Partial<TicketDisplay> = {}): TicketDisplay {
  return {
    selector: 'ticket-1',
    eventId: 'event-a',
    eventName: 'Mission Night Market',
    startsAt: '2026-09-12T18:00:00-07:00',
    endsAt: '2026-09-12T22:00:00-07:00',
    venueName: 'Valencia Street Commons',
    admissionLabel: 'General Admission',
    attendeeLabel: 'Demo guest',
    position: 1,
    totalInCollection: 1,
    directionsUrl: 'https://maps.example.invalid/mission-night-market',
    status: 'valid',
    admissionCredential: 'admission-private-test',
    ...overrides,
  } as TicketDisplay
}

function renderFocused(value: TicketDisplay, now = () => new Date('2026-09-03T12:00:00Z')) {
  return render(
    <FocusedTicketView
      nextSelector={null}
      now={now}
      onSelect={() => undefined}
      previousSelector={null}
      ticket={value}
      walletCapability={walletCapability}
    />,
  )
}

describe('FocusedTicketView', () => {
  it('renders a reliable QR only for a currently valid ticket', async () => {
    renderFocused(ticket())

    expect(screen.getByTestId('admission-qr')).toBeVisible()
    await waitFor(() => expect(screen.getByLabelText('Admission QR code')).toHaveAttribute('data-qr-ready', 'true'))
    expect(qrCanvas).toHaveBeenLastCalledWith(expect.objectContaining({
      bgColor: '#ffffff',
      boostLevel: false,
      fgColor: '#000000',
      level: 'Q',
      marginSize: 4,
      size: 240,
      value: 'admission-private-test',
    }))
  })

  it.each([
    ['used', 'Already used'],
    ['refunded', 'Refunded'],
    ['cancelled', 'Cancelled'],
  ] as const)('renders %s as a distinct non-scannable state', (status, label) => {
    renderFocused(ticket({ status, admissionCredential: null }))

    expect(screen.getAllByText(label)[0]).toBeVisible()
    expect(screen.queryByTestId('admission-qr')).not.toBeInTheDocument()
  })

  it('derives an ended non-scannable state from a valid timestamp', () => {
    renderFocused(ticket(), () => new Date('2026-09-13T12:00:00Z'))

    expect(screen.getAllByText('Event ended')[0]).toBeVisible()
    expect(screen.queryByTestId('admission-qr')).not.toBeInTheDocument()
  })

  it('fails closed when endsAt is invalid', () => {
    renderFocused(ticket({ endsAt: 'invalid' }))

    expect(screen.getAllByText('Ticket unavailable')[0]).toBeVisible()
    expect(screen.queryByTestId('admission-qr')).not.toBeInTheDocument()
  })

  it('renders safe directions and omits unsupported wallet actions', () => {
    renderFocused(ticket())

    expect(screen.getByRole('link', { name: 'Get directions' })).toHaveAttribute('rel', 'noreferrer')
    expect(screen.queryByRole('button', { name: /wallet/i })).not.toBeInTheDocument()
  })

  it('omits directions when no URL is available', () => {
    renderFocused(ticket({ directionsUrl: undefined }))

    expect(screen.queryByRole('link', { name: 'Get directions' })).not.toBeInTheDocument()
  })
})

describe('AdmissionQr', () => {
  it('keeps the credential confined to the QR renderer', () => {
    const view = render(<AdmissionQr credential="credential-only-for-renderer" />)

    expect(view.container).not.toHaveTextContent('credential-only-for-renderer')
    expect(view.container.innerHTML).not.toContain('credential-only-for-renderer')
    expect(qrCanvas).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'credential-only-for-renderer' }))
  })
})

it('removes an already mounted QR when the event ends', async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2027-01-01T12:00:00Z'))
 try{
  const {act}=await import('@testing-library/react')
  renderFocused(ticket({endsAt:'2027-01-01T12:00:01Z'}),()=>new Date())
  expect(screen.getByTestId('admission-qr')).toBeInTheDocument()
  await act(async()=>{vi.advanceTimersByTime(1100)})
  expect(screen.queryByTestId('admission-qr')).toBeNull();expect(screen.getByRole('heading',{name:'Event ended'})).toBeInTheDocument()
 }finally{vi.useRealTimers()}
})


it('attaches refund support only to refunded tickets without manufacturing a reference or QR', () => {
  renderFocused(ticket({ status: 'refunded', admissionCredential: null }))
  expect(screen.getByText(/Previously used tickets keep their check-in history/)).toBeVisible()
  expect(screen.queryByText(/Order #/)).not.toBeInTheDocument()
  expect(screen.queryByTestId('admission-qr')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /recover/i })).not.toBeInTheDocument()
})
