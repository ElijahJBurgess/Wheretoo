import { ReadState } from '../../components/ui/ReadState'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BuyerHeader } from '../buyer-journey/BuyerPrimitives'
import { TicketCollectionPage } from '../ticket-experience/customer/TicketCollectionPage'
import { useTicketDocumentPrivacy } from '../ticket-experience/customer/useTicketDocumentPrivacy'
import type { TicketCollectionReader } from '../ticket-experience/contracts/ticketCollection'
import type { WalletProvider } from '../ticket-experience/contracts/wallet'
import { publicTicketDeliveryApi } from './delivery.public-api'
import { readTicketAccess, shortenTicketAccess } from './delivery.session'
import { uuid, type AccessIndex } from './delivery.schemas'
import './ticket-delivery.css'
const walletProvider: WalletProvider = { getCapability: () => ({ kind: 'unavailable', label: 'Add to Wallet — Coming later' }) }
function Unavailable() {
  return <main className='buyer-page delivery-recovery'><BuyerHeader /><div className='buyer-content'><ReadState headingAs='h1' status='unavailable' title='Ticket link unavailable' description='This link can’t open your tickets. Request a new link with the email you used to buy tickets or RSVP.' action={<Link className='ui-button buyer-primary' to='/tickets/recover'>Find your tickets</Link>} /></div></main>
}
type AccessFailure = 'unavailable' | 'temporary' | 'rate_limited'
function accessFailure(error: unknown): AccessFailure {
  const kind = typeof error === 'object' && error !== null && 'kind' in error ? error.kind : undefined
  return kind === 'unavailable' || kind === 'invalid_input' ? 'unavailable' : kind === 'rate_limited' ? 'rate_limited' : 'temporary'
}
function TemporaryAccess({ kind, retry }: { kind: 'temporary' | 'rate_limited'; retry(): void }) {
  return <main className='buyer-page delivery-recovery'><BuyerHeader /><div className='buyer-content'><ReadState headingAs='h1' status='unavailable' title={kind === 'rate_limited' ? 'Please wait a moment' : 'Tickets temporarily unavailable'} description={kind === 'rate_limited' ? 'Ticket access is busy. Wait a moment, then try this same link again.' : 'Check your connection, then try this same link again. You do not need another email.'} action={<button className='ui-button buyer-primary' onClick={retry}>Try this link again</button>} /></div></main>
}
function integer(value: string | null, min: number, max: number): number | null {
  if (value === null || !/^(0|[1-9]\d*)$/.test(value)) return null
  const number = Number(value)
  return number >= min && number <= max ? number : null
}
function date(value: string | null) { if (value === null) return 'Schedule unavailable'; return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
export function TicketEmailAccessPage() {
  useTicketDocumentPrivacy()
  const [session] = useState(readTicketAccess)
  const [expired, setExpired] = useState(false)
  const [expiresAt, setExpiresAt] = useState(session?.expiresAt ?? 0)
  const [memberFailure, setMemberFailure] = useState<{ selector: number; kind: AccessFailure } | null>(null)
  const [version, setVersion] = useState(0)
  const [params] = useSearchParams()
  const member = integer(params.get('member'), 1, 200)
  const requestedPage = params.has('member') && member !== null ? Math.floor((member - 1) / 20) : params.has('page') ? integer(params.get('page'), 0, 9) : 0
  const ticketSelector = params.get('ticket') ?? undefined
  const invalid = requestedPage === null || (params.has('member') && member === null) || (ticketSelector !== undefined && !uuid.safeParse(ticketSelector).success)
  const page = requestedPage ?? 0
  const [loaded, setLoaded] = useState<{ page: number; version: number; index: AccessIndex | null; failure?: AccessFailure } | null>(null)
  useEffect(() => {
    if (!session || invalid || expired) return
    const controller = new AbortController()
    publicTicketDeliveryApi.index(session.token, page, controller.signal).then(index => {
      if (controller.signal.aborted) return
      shortenTicketAccess(index.expiresAt)
      setExpiresAt(value => Math.min(value, Date.parse(index.expiresAt)))
      setLoaded({ page, version, index })
    }, error => { if (!controller.signal.aborted) setLoaded({ page, version, index: null, failure: accessFailure(error) }) })
    return () => controller.abort()
  }, [session, invalid, expired, page, version])
  const resolved = loaded?.page === page && loaded.version === version ? loaded : undefined
  const index = resolved?.index
  useEffect(() => {
    if (!session) return
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [session, expiresAt])
  const selected = index?.collections.find(row => row.selector === (member ?? (index.total === 1 ? 1 : null)))
  const reader = useMemo<TicketCollectionReader>(() => ({
    async readCollection({ signal }) {
      if (!session || !selected || readTicketAccess()?.token !== session.token) return { kind: 'unavailable' }
      try {
        const result = await publicTicketDeliveryApi.member(session.token, selected.selector, selected.sourceKind, signal)
        signal?.throwIfAborted()
        if (result.collection.tickets.length !== selected.quantity || result.collection.tickets.some(ticket => ticket.eventName !== selected.eventName || (ticket.startsAt === null || selected.startsAt === null ? ticket.startsAt !== selected.startsAt : Date.parse(ticket.startsAt) !== Date.parse(selected.startsAt)))) return { kind: 'unavailable' }
        shortenTicketAccess(result.expiresAt)
        setExpiresAt(value => Math.min(value, Date.parse(result.expiresAt)))
        return { kind: 'ready', collection: result.collection }
      } catch (error) {
        signal?.throwIfAborted()
        setMemberFailure({ selector: selected.selector, kind: accessFailure(error) })
        return { kind: 'unavailable' }
      }
    },
  }), [session, selected])
  const accessContext = useMemo(() => ({ collectionKey: 'email-member-' + selected?.selector, ticketSelector, ticketPath: (selector: string | null) => `/ticket-access?member=${selected?.selector}${selector === null ? '' : '&ticket=' + encodeURIComponent(selector)}` }), [selected?.selector, ticketSelector])
  const failedMember = selected && memberFailure?.selector === selected.selector ? memberFailure : null
  if (!session || expired || invalid || resolved?.failure === 'unavailable' || failedMember?.kind === 'unavailable' || (member !== null && index && !selected)) return <Unavailable />
  if (resolved?.failure === 'temporary' || resolved?.failure === 'rate_limited') return <TemporaryAccess kind={resolved.failure} retry={() => setVersion(v => v + 1)} />
  if (failedMember?.kind === 'temporary' || failedMember?.kind === 'rate_limited') return <TemporaryAccess kind={failedMember.kind} retry={() => setMemberFailure(null)} />
  if (!index) return <main className='buyer-page buyer-state'><BuyerHeader /><ReadState headingAs='h1' status='loading' skeleton='detail-fields' title='Loading your tickets…' /></main>
  if (selected) return <>
    {index.total > 1 && <nav className='delivery-access-back' aria-label='Ticket collections'><Link to={`/ticket-access?page=${page}`}>Back to collections</Link></nav>}
    <TicketCollectionPage key={selected.selector} reader={reader} walletProvider={walletProvider} accessContext={accessContext} />
  </>
  return <main className='buyer-page delivery-index'><BuyerHeader /><div className='buyer-content'>
    <h1>Your tickets</h1><p>Choose a purchase or RSVP. Each collection keeps its original tickets.</p>
    <ul className='delivery-index-list'>{index.collections.map(row => <li key={row.selector}><Link to={`/ticket-access?member=${row.selector}`}>
      <span>Collection {row.selector}</span><strong>{row.eventName}</strong><span>{date(row.startsAt)}</span><span>{row.quantity} admission{row.quantity === 1 ? '' : 's'} · {row.sourceKind === 'paid_order' ? 'Purchased' : 'Registered'} {date(row.createdAt)}</span>
    </Link></li>)}</ul>
    <nav className='delivery-pagination' aria-label='Collection pages'>{page > 0 && <Link to={`/ticket-access?page=${page - 1}`}>Previous collections</Link>}{index.nextPage !== null && <Link to={`/ticket-access?page=${index.nextPage}`}>Next collections</Link>}</nav>
    <p>Showing {page * 20 + 1}–{page * 20 + index.collections.length} of {index.total} collections</p>
    <button className='ui-button buyer-secondary' onClick={() => setVersion(v => v + 1)}>Refresh collections</button>
  </div></main>
}
