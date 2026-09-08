import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { AsyncState } from '../../../components/ui/AsyncState'
import type { TicketCollectionReader, TicketCollectionResult } from '../contracts/ticketCollection'
import type { WalletProvider } from '../contracts/wallet'
import { FocusedTicketView } from './FocusedTicketView'
import { TicketCollectionOverview } from './TicketCollectionOverview'
import { useTicketDocumentPrivacy } from './useTicketDocumentPrivacy'

export type TicketCollectionPageProps = {
  reader: TicketCollectionReader
  walletProvider: WalletProvider
  now?: () => Date
}

type RequestKey = {
  collectionBearer: string
  reader: TicketCollectionReader
  requestVersion: number
}

type ReaderState = (
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'resolved'; result: TicketCollectionResult }
) & { requestKey: RequestKey }

function ticketPath(collectionBearer: string, selector: string | null): string {
  const base = `/tickets/${encodeURIComponent(collectionBearer)}`
  return selector === null ? base : `${base}/${encodeURIComponent(selector)}`
}

function TicketPageState({ children }: { children: React.ReactNode }) {
  return <main className="ticket-page ticket-page--state">{children}</main>
}

export function TicketCollectionPage({ reader, walletProvider, now = () => new Date() }: TicketCollectionPageProps) {
  useTicketDocumentPrivacy()
  const navigate = useNavigate()
  const { collectionBearer = '', ticketSelector: routeSelector } = useParams()
  const [requestVersion, setRequestVersion] = useState(0)
  const requestKey = useMemo(
    () => ({ collectionBearer, reader, requestVersion }),
    [collectionBearer, reader, requestVersion],
  )
  const [storedReaderState, setReaderState] = useState<ReaderState>(() => ({ kind: 'loading', requestKey }))
  const readerState: ReaderState = storedReaderState.requestKey === requestKey
    ? storedReaderState
    : { kind: 'loading', requestKey }

  useEffect(() => {
    const controller = new AbortController()

    requestKey.reader.readCollection({
      collectionBearer: requestKey.collectionBearer,
      signal: controller.signal,
    }).then(
      (result) => {
        if (!controller.signal.aborted) setReaderState({ kind: 'resolved', requestKey, result })
      },
      () => {
        if (!controller.signal.aborted) setReaderState({ kind: 'error', requestKey })
      },
    )

    return () => controller.abort()
  }, [requestKey])

  const readyCollection = readerState.kind === 'resolved' && readerState.result.kind === 'ready'
    ? readerState.result.collection
    : null
  const defaultFocusedSelector = readyCollection?.tickets.length === 1
    ? readyCollection.tickets[0]?.selector ?? null
    : null
  const [visibleSelector, setVisibleSelector] = useState<string | null>(routeSelector ?? null)
  const [pendingSelection, setPendingSelection] = useState<{
    selector: string | null
    updateUrl: boolean
    restoreFocus: boolean
  } | null>(null)
  const [focusSelector, setFocusSelector] = useState<string | null>(null)

  function requestSelection(selector: string | null) {
    setPendingSelection({ selector, updateUrl: true, restoreFocus: true })
    setVisibleSelector(null)
  }

  useEffect(() => {
    const next = routeSelector ?? defaultFocusedSelector
    if (pendingSelection !== null || next === visibleSelector) return
    // This deliberate blank commit removes the prior QR before a history-selected QR can mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingSelection({ selector: next, updateUrl: false, restoreFocus: false })
    setVisibleSelector(null)
  }, [defaultFocusedSelector, pendingSelection, routeSelector, visibleSelector])

  useEffect(() => {
    if (visibleSelector !== null || pendingSelection === null) return
    const routeSelection = routeSelector ?? defaultFocusedSelector
    if (pendingSelection.updateUrl && routeSelection !== pendingSelection.selector) {
      navigate(ticketPath(collectionBearer, pendingSelection.selector))
      return
    }
    // The prior commit contains no QR; this second commit can now mount only the selected one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleSelector(pendingSelection.selector)
    setFocusSelector(pendingSelection.restoreFocus ? pendingSelection.selector : null)
    setPendingSelection(null)
  }, [collectionBearer, defaultFocusedSelector, navigate, pendingSelection, routeSelector, visibleSelector])

  const selectedIndex = useMemo(
    () => readyCollection?.tickets.findIndex((ticket) => ticket.selector === visibleSelector) ?? -1,
    [readyCollection, visibleSelector],
  )

  if (readerState.kind === 'loading') {
    return (
      <TicketPageState>
        <AsyncState status="loading" title="Loading tickets" description="Getting your private ticket collection." />
      </TicketPageState>
    )
  }

  if (readerState.kind === 'error') {
    return (
      <TicketPageState>
        <AsyncState
          action={<Button onClick={() => setRequestVersion((version) => version + 1)}>Try again</Button>}
          description="Check your connection, then try the private link again."
          status="error"
          title="Tickets unavailable"
        />
      </TicketPageState>
    )
  }

  if (readerState.result.kind === 'empty') {
    return (
      <TicketPageState>
        <AsyncState
          action={<Link className="ui-button ui-button--secondary" to={`/events/${encodeURIComponent(readerState.result.eventId)}`}>View event</Link>}
          description="This collection does not currently contain a ticket."
          status="empty"
          title="No tickets available"
        />
      </TicketPageState>
    )
  }

  if (readerState.result.kind !== 'ready' || readerState.result.collection.tickets.length === 0) {
    return (
      <TicketPageState>
        <AsyncState
          description="Return to the original event link or ticket email and try again."
          status="error"
          title={readerState.result.kind === 'not_enabled' ? 'Ticket experience not enabled' : 'Tickets unavailable'}
        />
      </TicketPageState>
    )
  }

  const collection = readerState.result.collection
  const basePath = ticketPath(collectionBearer, null)

  if (pendingSelection !== null) return <main className="ticket-page" />

  if (visibleSelector === null || (selectedIndex < 0 && collection.tickets.length > 1)) {
    return (
      <main className="ticket-page">
        <TicketCollectionOverview
          collectionLabel={collection.collectionLabel}
          ticketHref={(selector) => ticketPath(collectionBearer, selector)}
          tickets={collection.tickets}
        />
      </main>
    )
  }

  const focusedIndex = selectedIndex < 0 ? 0 : selectedIndex
  const selectedTicket = collection.tickets[focusedIndex]
  if (!selectedTicket) return null

  return (
    <main className="ticket-page">
      {collection.tickets.length > 1
        ? <Link className="ticket-page__back" to={basePath}>← Back to all tickets</Link>
        : null}
      <FocusedTicketView
        focusHeadingOnMount={focusSelector === selectedTicket.selector}
        key={selectedTicket.selector}
        nextSelector={collection.tickets[focusedIndex + 1]?.selector ?? null}
        now={now}
        onSelect={requestSelection}
        onHeadingFocused={() => setFocusSelector(null)}
        previousSelector={collection.tickets[focusedIndex - 1]?.selector ?? null}
        ticket={selectedTicket}
        walletCapability={walletProvider.getCapability()}
      />
    </main>
  )
}
