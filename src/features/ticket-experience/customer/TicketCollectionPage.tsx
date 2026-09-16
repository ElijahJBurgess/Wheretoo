import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { ReadState } from '../../../components/ui/ReadState'
import type { TicketCollectionReader, TicketCollectionResult } from '../contracts/ticketCollection'
import type { WalletProvider } from '../contracts/wallet'
import { BuyerIcon } from '../../buyer-journey/BuyerPrimitives'
import { FocusedTicketView } from './FocusedTicketView'
import { TicketCollectionOverview } from './TicketCollectionOverview'
import { useTicketDocumentPrivacy } from './useTicketDocumentPrivacy'

export type TicketCollectionPageProps = {
  reader: TicketCollectionReader
  walletProvider: WalletProvider
  now?: () => Date
  accessContext?: { collectionKey: string; ticketSelector?: string; ticketPath(selector: string | null): string }
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
  return <main className="buyer-page buyer-state">{children}</main>
}

export function TicketCollectionPage({ reader, walletProvider, now = () => new Date(), accessContext }: TicketCollectionPageProps) {
  useTicketDocumentPrivacy()
  const navigate = useNavigate()
  const { collectionBearer: routeBearer = '', ticketSelector: legacySelector } = useParams()
  const collectionBearer = accessContext?.collectionKey ?? routeBearer
  const routeSelector = accessContext ? accessContext.ticketSelector : legacySelector
  const pathForTicket = useCallback((selector: string | null) => accessContext ? accessContext.ticketPath(selector) : ticketPath(collectionBearer, selector), [accessContext, collectionBearer])
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
      navigate(pathForTicket(pendingSelection.selector))
      return
    }
    // The prior commit contains no QR; this second commit can now mount only the selected one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleSelector(pendingSelection.selector)
    setFocusSelector(pendingSelection.restoreFocus ? pendingSelection.selector : null)
    setPendingSelection(null)
  }, [pathForTicket, defaultFocusedSelector, navigate, pendingSelection, routeSelector, visibleSelector])

  const selectedIndex = useMemo(
    () => readyCollection?.tickets.findIndex((ticket) => ticket.selector === visibleSelector) ?? -1,
    [readyCollection, visibleSelector],
  )

  if (readerState.kind === 'loading') {
    return (
      <TicketPageState>
        <ReadState headingAs="h1" skeleton="detail-fields" status="loading" title="Loading tickets" description="Getting your private ticket collection." />
      </TicketPageState>
    )
  }

  if (readerState.kind === 'error') {
    return (
      <TicketPageState>
        <ReadState headingAs="h1"
          action={<Button onClick={() => setRequestVersion((version) => version + 1)}>Try again</Button>}
          description="Check your connection, then try the private link again."
          status="unavailable"
          title="Tickets unavailable"
        />
      </TicketPageState>
    )
  }

  if (readerState.result.kind === 'empty') {
    return (
      <TicketPageState>
        <ReadState headingAs="h1"
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
        <ReadState headingAs="h1"
          action={<Link className="ui-button ui-button--secondary" to="/tickets/recover">Find your tickets</Link>}
          description="Return to your ticket email, or request a new link using your email address."
          status="unavailable"
          title={readerState.result.kind === 'not_enabled' ? 'Ticket experience not enabled' : 'Tickets unavailable'}
        />
      </TicketPageState>
    )
  }

  const collection = readerState.result.collection

  if (pendingSelection !== null) return <main className="buyer-page" />

  if (visibleSelector === null || (selectedIndex < 0 && collection.tickets.length > 1)) {
    return (
      <main className="buyer-page">
        <TicketCollectionOverview
          collectionLabel={collection.collectionLabel}
          freeEventClock={collection.registrationId ? now : undefined}
          ticketHref={pathForTicket}
          tickets={collection.tickets}
        />
      </main>
    )
  }

  const focusedIndex = selectedIndex < 0 ? 0 : selectedIndex
  const selectedTicket = collection.tickets[focusedIndex]
  if (!selectedTicket) return null

  return (
    <main className="buyer-page">
      <FocusedTicketView
        backAction={collection.tickets.length > 1 ? <Link className="buyer-icon-button" aria-label="Back to all tickets" to={pathForTicket(null)}><BuyerIcon name="close" /></Link> : undefined}
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
