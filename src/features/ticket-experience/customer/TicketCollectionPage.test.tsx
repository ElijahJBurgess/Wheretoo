import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type {
  TicketCollectionReader,
  TicketCollectionResult,
  TicketDisplay,
} from '../contracts/ticketCollection'
import { fixtureTicketCollectionReader, fixtureWalletProvider } from '../fixtures/adapters'
import { TicketCollectionPage } from './TicketCollectionPage'

vi.mock('qrcode.react', () => ({
  QRCodeCanvas: () => <canvas aria-label="Admission QR code" />,
}))

const ticketTestNow = () => new Date('2026-09-03T12:00:00Z')

type RenderTicketRouteInput = {
  collectionBearer?: string
  selector?: string
  reader: TicketCollectionReader
  now?: () => Date
}

function ticketPath(collectionBearer: string, selector: string | null): string {
  const base = `/tickets/${encodeURIComponent(collectionBearer)}`
  return selector === null ? base : `${base}/${encodeURIComponent(selector)}`
}

function renderTicketRoute(input: RenderTicketRouteInput): ReturnType<typeof render> {
  const collectionBearer = input.collectionBearer ?? 'collection-private-test'
  const path = ticketPath(collectionBearer, input.selector ?? null)

  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/tickets/:collectionBearer/:ticketSelector?"
          element={(
            <TicketCollectionPage
              now={input.now ?? ticketTestNow}
              reader={input.reader}
              walletProvider={fixtureWalletProvider}
            />
          )}
        />
      </Routes>
    </MemoryRouter>,
  )
}

function ticket(overrides: Partial<TicketDisplay> = {}): TicketDisplay {
  const base: TicketDisplay = {
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
  }

  return { ...base, ...overrides } as TicketDisplay
}

function readerFor(...tickets: readonly TicketDisplay[]): TicketCollectionReader {
  return {
    async readCollection(): Promise<TicketCollectionResult> {
      return {
        kind: 'ready',
        collection: {
          collectionLabel: 'Mission Night Market tickets',
          eventId: 'event-a',
          tickets,
        },
      }
    },
  }
}

function deferredResult() {
  let resolve!: (result: TicketCollectionResult) => void
  const promise = new Promise<TicketCollectionResult>((next) => { resolve = next })
  return { promise, resolve }
}

describe('TicketCollectionPage recovery', () => {
  it('removes the previous QR and rejects late reads across A to B to A', async () => {
    const pendingB = deferredResult()
    const pendingA = deferredResult()
    const readCollection = vi.fn<TicketCollectionReader['readCollection']>()
      .mockResolvedValueOnce({ kind: 'ready', collection: { collectionLabel: 'Collection A', eventId: 'event-a', tickets: [ticket()] } })
      .mockImplementationOnce(() => pendingB.promise)
      .mockImplementationOnce(() => pendingA.promise)
    const router = createMemoryRouter([{ path: '/tickets/:collectionBearer', element: <TicketCollectionPage now={ticketTestNow} reader={{ readCollection }} walletProvider={fixtureWalletProvider} /> }], { initialEntries: ['/tickets/synthetic-a'] })
    render(<RouterProvider router={router} />)
    await screen.findByLabelText('Admission QR code')
    await act(() => router.navigate('/tickets/synthetic-b'))
    expect(screen.queryByLabelText('Admission QR code')).not.toBeInTheDocument()
    await act(() => router.navigate('/tickets/synthetic-a'))
    expect(screen.queryByLabelText('Admission QR code')).not.toBeInTheDocument()
    await act(async () => pendingB.resolve({ kind: 'ready', collection: { collectionLabel: 'Late collection B', eventId: 'event-b', tickets: [ticket({ eventName: 'Late private event B' })] } }))
    expect(screen.queryByText('Late private event B')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Admission QR code')).not.toBeInTheDocument()
    await act(async () => pendingA.resolve({ kind: 'ready', collection: { collectionLabel: 'Fresh A', eventId: 'event-a', tickets: [ticket()] } }))
    expect(await screen.findAllByLabelText('Admission QR code')).toHaveLength(1)
    expect(readCollection).toHaveBeenCalledTimes(3)
  })
  it('shows loading while the collection reader is pending', () => {
    const pending = deferredResult()
    renderTicketRoute({ reader: { readCollection: () => pending.promise } })

    expect(screen.getByText('Loading tickets')).toBeVisible()
  })

  it('retries a thrown reader failure without exposing provider details', async () => {
    const user = userEvent.setup()
    const readCollection = vi
      .fn<TicketCollectionReader['readCollection']>()
      .mockRejectedValueOnce(new Error('collection-private-test admission-private-test provider dump'))
      .mockResolvedValueOnce({
        kind: 'ready',
        collection: { collectionLabel: 'Tickets', eventId: 'event-a', tickets: [ticket()] },
      })
    const view = renderTicketRoute({ reader: { readCollection } })

    expect(await screen.findByText('Tickets unavailable')).toBeVisible()
    expect(view.container).not.toHaveTextContent('provider dump')
    expect(view.container).not.toHaveTextContent('collection-private-test')
    expect(view.container).not.toHaveTextContent('admission-private-test')

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Ticket 1' })).toBeVisible()
  })

  it('renders privacy-equivalent unavailable recovery for different bearers', async () => {
    const unavailable: TicketCollectionReader = {
      async readCollection() { return { kind: 'unavailable' } },
    }
    const first = renderTicketRoute({ collectionBearer: 'first-private-bearer', reader: unavailable })
    expect(await screen.findByText('Tickets unavailable')).toBeVisible()
    const firstText = first.container.textContent
    expect(screen.queryByRole('link', { name: /events/i })).not.toBeInTheDocument()
    first.unmount()

    const second = renderTicketRoute({ collectionBearer: 'second-private-bearer', reader: unavailable })
    expect(await screen.findByText('Tickets unavailable')).toBeVisible()
    expect(second.container.textContent).toBe(firstText)
    expect(second.container).not.toHaveTextContent('second-private-bearer')
  })

  it('links a known empty collection back to its event', async () => {
    renderTicketRoute({
      reader: { async readCollection() { return { kind: 'empty', eventId: 'event-a' } } },
    })

    expect(await screen.findByText('No tickets available')).toBeVisible()
    expect(screen.getByRole('link', { name: 'View event' })).toHaveAttribute('href', '/events/event-a')
  })
})

describe('TicketCollectionPage collection navigation', () => {
  it.each(['wh_test_collection_paid', 'wh_test_collection_rsvp'])(
    'renders one admission through the same focused view for %s',
    async (collectionBearer) => {
      renderTicketRoute({
        collectionBearer,
        reader: fixtureTicketCollectionReader,
        now: () => new Date('2026-09-03T12:00:00Z'),
      })

      expect(await screen.findByRole('heading', { name: 'Ticket 1' })).toBeVisible()
      expect(screen.getAllByTestId('admission-qr')).toHaveLength(1)
      expect(screen.queryByText(/payment|order|rsvp source/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /previous|next/i })).not.toBeInTheDocument()
    },
  )

  it('renders separate same-label tickets in the overview without credentials or QR codes', async () => {
    const first = ticket({ selector: 'ticket-1', position: 1, totalInCollection: 2 })
    const second = ticket({
      selector: 'ticket-2',
      position: 2,
      totalInCollection: 2,
      admissionCredential: 'second-admission-private-test',
    })
    const view = renderTicketRoute({ reader: readerFor(first, second) })

    expect(await screen.findByRole('heading', { name: 'Ticket wallet' })).toBeVisible()
    expect(screen.getAllByText('General Admission')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /Ticket 1.*General Admission/i })).toBeVisible()
    expect(screen.getByRole('link', { name: /Ticket 2.*General Admission/i })).toBeVisible()
    expect(screen.queryByTestId('admission-qr')).not.toBeInTheDocument()
    expect(view.container.innerHTML).not.toContain('admission-private-test')
    expect(view.container.innerHTML).not.toContain('second-admission-private-test')
  })

  it('opens a valid selector deep link and provides a deterministic overview return', async () => {
    const first = ticket({ selector: 'ticket-1', position: 1, totalInCollection: 2 })
    const second = ticket({ selector: 'ticket-2', position: 2, totalInCollection: 2 })
    renderTicketRoute({ selector: 'ticket-2', reader: readerFor(first, second) })

    expect(await screen.findByRole('heading', { name: 'Ticket 2' })).toBeVisible()
    expect(screen.getByText('Ticket 2 of 2')).toBeVisible()
    expect(screen.getByRole('link', { name: /Back to all tickets/ })).toHaveAttribute(
      'href',
      '/tickets/collection-private-test',
    )
  })

  it('falls back to the authorized overview for an unknown multi-ticket selector', async () => {
    const first = ticket({ selector: 'ticket-1', position: 1, totalInCollection: 2 })
    const second = ticket({ selector: 'ticket-2', position: 2, totalInCollection: 2 })
    renderTicketRoute({ selector: 'unknown', reader: readerFor(first, second) })

    expect(await screen.findByRole('heading', { name: 'Ticket wallet' })).toBeVisible()
    expect(screen.queryByTestId('admission-qr')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ticket 1.*General Admission/i })).toBeVisible()
    expect(screen.getByRole('link', { name: /Ticket 2.*General Admission/i })).toBeVisible()
  })

  it('falls back to the sole focused ticket for an unknown one-ticket selector', async () => {
    renderTicketRoute({ selector: 'unknown', reader: readerFor(ticket()) })

    expect(await screen.findByRole('heading', { name: 'Ticket 1' })).toBeVisible()
    expect(screen.getByTestId('admission-qr')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Back to all tickets' })).not.toBeInTheDocument()
  })

  it('restores focus after keyboard navigation in both directions and announces the selected position', async () => {
    const user = userEvent.setup()
    const first = ticket({ selector: 'ticket-1', position: 1, totalInCollection: 2 })
    const second = ticket({ selector: 'ticket-2', position: 2, totalInCollection: 2 })
    renderTicketRoute({ selector: 'ticket-1', reader: readerFor(first, second) })
    const next = await screen.findByRole('button', { name: 'Next ticket' })

    next.focus()
    await user.keyboard('{Enter}')

    const nextHeading = await screen.findByRole('heading', { name: 'Ticket 2' })
    expect(nextHeading).toBeVisible()
    expect(nextHeading).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Ticket 2 of 2')

    screen.getByRole('button', { name: 'Previous ticket' }).focus()
    await user.keyboard('{Enter}')

    const previousHeading = await screen.findByRole('heading', { name: 'Ticket 1' })
    expect(previousHeading).toBeVisible()
    expect(previousHeading).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Ticket 1 of 2')
  })

  it('preserves focused and overview state through browser history', async () => {
    const first = ticket({ selector: 'ticket-1', position: 1, totalInCollection: 2 })
    const second = ticket({ selector: 'ticket-2', position: 2, totalInCollection: 2 })
    const router = createMemoryRouter([
      {
        path: '/tickets/:collectionBearer/:ticketSelector?',
        element: (
          <TicketCollectionPage
            now={ticketTestNow}
            reader={readerFor(first, second)}
            walletProvider={fixtureWalletProvider}
          />
        ),
      },
    ], { initialEntries: ['/tickets/history-test'] })
    render(<RouterProvider router={router} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: /Ticket 1.*General Admission/i }))
    expect(await screen.findByRole('heading', { name: 'Ticket 1' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Next ticket' }))
    expect(await screen.findByRole('heading', { name: 'Ticket 2' })).toBeVisible()

    await act(() => router.navigate(-1))
    expect(await screen.findByRole('heading', { name: 'Ticket 1' })).toBeVisible()
    await act(() => router.navigate(1))
    expect(await screen.findByRole('heading', { name: 'Ticket 2' })).toBeVisible()
    await act(() => router.navigate('/tickets/history-test'))
    expect(await screen.findByRole('heading', { name: 'Ticket wallet' })).toBeVisible()
    expect(screen.queryByTestId('admission-qr')).not.toBeInTheDocument()
  })

  it('unmounts the old QR before mounting the next QR', async () => {
    const user = userEvent.setup()
    const first = ticket({ selector: 'ticket-1', position: 1, totalInCollection: 2 })
    const second = ticket({ selector: 'ticket-2', position: 2, totalInCollection: 2 })
    renderTicketRoute({ selector: 'ticket-1', reader: readerFor(first, second) })
    const oldQr = await screen.findByTestId('admission-qr')
    const mutations: string[] = []
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if ([...record.removedNodes].some((node) => node === oldQr || (node instanceof Element && node.contains(oldQr)))) {
          mutations.push('old-unmounted')
        }
        if ([...record.addedNodes].some((node) => node instanceof Element && (
          node.matches('[data-testid="admission-qr"]') || node.querySelector('[data-testid="admission-qr"]')
        ))) {
          mutations.push('new-mounted')
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    await user.click(screen.getByRole('button', { name: 'Next ticket' }))
    await waitFor(() => expect(screen.getByTestId('admission-qr')).not.toBe(oldQr))
    observer.disconnect()

    expect(oldQr.isConnected).toBe(false)
    expect(mutations.indexOf('old-unmounted')).toBeGreaterThanOrEqual(0)
    expect(mutations.indexOf('new-mounted')).toBeGreaterThan(mutations.indexOf('old-unmounted'))
    expect(screen.getAllByTestId('admission-qr')).toHaveLength(1)
  })
})

it('labels ended free admissions as event ended while preserving Used history', async () => {
  const reader: TicketCollectionReader = { readCollection: async () => ({ kind: 'ready', collection: {
    registrationId: 'registration-a', registrationStatus: 'confirmed', eventId: 'event-a', collectionLabel: 'Free tickets',
    tickets: [ticket({totalInCollection: 2}), ticket({selector:'ticket-2',position:2,totalInCollection:2,status:'used',admissionCredential:null,usedAt:'2026-09-12T19:00:00-07:00'})],
  } }) }
  renderTicketRoute({reader,now:()=>new Date('2026-09-13T08:00:00Z')})
  await screen.findByRole('heading',{name:'Ticket wallet'})
  expect(screen.getByRole('link',{name:'Ticket 1, General Admission, Event ended'})).toBeInTheDocument()
  expect(screen.getByRole('link',{name:'Ticket 2, General Admission, Already used'})).toBeInTheDocument()
  expect(screen.queryByRole('heading',{name:'Available tickets'})).toBeNull()
})
