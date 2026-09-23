import { EventExportControl } from './EventExportControl'
import { ReadState } from '../../components/ui/ReadState'
import { isOperationsAccessDenied } from './operations.errors'
import type { OrderFilter, OrderSummary } from './operations.schemas'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { useOwnedEvent } from '../events/event.queries'
import { useEventOrders } from './operations.queries'
import { OperationsError } from './OperationsUi'
import { money } from './operations.format'
import { statusLabel } from './operations.format'
export function OrganizerOrdersPage() {
  const { eventId = '' } = useParams()
  const session = useSession()
  const ownerId = session.status === 'authenticated' ? session.user.id : ''
  return <EventOrders key={`${ownerId}:${eventId}`} ownerId={ownerId} eventId={eventId} />
}
function EventOrders({ ownerId, eventId }: { ownerId: string; eventId: string }) {
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<OrderFilter>('all')
  const [previousRows, setPreviousRows] = useState<OrderSummary[]>([])
  const query = useEventOrders(ownerId, eventId, search, status)
  const event = useOwnedEvent(eventId, ownerId, { revalidateOnMount: true })
  const verifiedEvent = event.isFetchedAfterMount && !event.isError ? event.data : undefined
  const accessDenied = isOperationsAccessDenied(query.error)
  const rows = accessDenied ? [] : query.isFetchedAfterMount ? query.data?.pages.flatMap((page) => page.orders) ?? previousRows : previousRows
  return (
    <section className='operations-page'>
      <Link className='ops-back' to={`/organizer/events/${eventId}/dashboard`}>
        ← Event dashboard
      </Link>
      <header className='ops-page-heading'>
        <p>
          {verifiedEvent?.title ??
            (event.isPending || !event.isFetchedAfterMount
              ? 'Loading event…'
              : 'Event context unavailable')}
        </p>
        <h1>Orders</h1>
        <p>Manage and view ticket orders for this event.</p>
      </header>
      {verifiedEvent?.admission_type === 'paid' && <EventExportControl eventId={eventId} source='paid' eventStatus={verifiedEvent.status} />}
      <form
        className='ops-search'
        onSubmit={(e) => {
          e.preventDefault()
          if (query.data) setPreviousRows(rows)
          setSearch(draft.trim())
        }}
      >
        <label className='sr-only' htmlFor='order-search'>
          Search by buyer name, email, or order number
        </label>
        <input
          id='order-search'
          type='search'
          maxLength={320}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder='Search name, email, or order number'
        />
        <button className='ops-button ops-button--primary' type='submit'>Search</button>
      </form>
      <div className='ops-event-filters' aria-label='Order status'>
        {(['all', 'paid', 'refunded'] as const).map(value => <button type='button' className='ops-button' key={value}
          aria-pressed={status === value} onClick={() => { setPreviousRows([]); setStatus(value) }}>
          {value === 'all' ? 'All' : value === 'paid' ? 'Paid' : 'Refunded'}
        </button>)}
      </div>
      {query.isFetching && !query.isFetchingNextPage && rows.length > 0 && <p className='ops-note' role='status'>Updating results…</p>}
      {(query.isPending || !query.isFetchedAfterMount) && rows.length === 0
        ? <ReadState status='loading' paused={query.fetchStatus === 'paused'} skeleton='order-rows' title='Loading orders…' />
        : (query.isError || !query.data) && rows.length === 0
        ? <OperationsError headingAs='h2' title='Orders unavailable' retry={() => void query.refetch()} />
        : (
          <>
            <div className='ops-orders-header' aria-hidden='true'>
              <span>Customer</span>
              <span>Tickets</span>
              <span>Total</span>
              <span>Status</span>
            </div>
            <ul className='ops-orders'>
              {rows.map((order) => (
                <li key={order.id}>
                  <Link to={`/organizer/events/${eventId}/orders/${order.id}`}>
                    <div>
                      <strong>{order.buyerName}</strong>
                      <span>{order.buyerEmail}</span>
                      <small>{order.orderNumber}</small>
                    </div>
                    <span className='ops-order-tiers'>
                      <span>{order.quantity} {order.quantity === 1 ? 'ticket' : 'tickets'}</span>
                      <small>{order.items.map((item) => `${item.tierName} ×${item.quantity}`).join(' · ')}</small>
                    </span>
                    <span>{money(order.totalMinor)}</span>
                    <span>
                      <span className={`ops-badge ops-badge--${order.status}`}>
                        {statusLabel(order.status)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {rows.length === 0 && (
              <ReadState status='empty' title={search || status !== 'all' ? 'No matching orders' : 'No orders yet'}
                description={search || status !== 'all' ? 'Try another search or order status.' : 'Orders will appear here after a purchase is confirmed.'}
                action={search ? <button className='ops-button' onClick={() => { setDraft(''); setSearch(''); setPreviousRows([]); document.getElementById('order-search')?.focus() }}>Clear search</button> : undefined}
                secondaryAction={status !== 'all' ? <button className='ops-button' onClick={() => { setStatus('all'); setPreviousRows([]) }}>Clear filter</button> : undefined} />
            )}
            {query.isFetchNextPageError && (
              <p role='alert'>More orders could not load. Try again.</p>
            )}
            {query.hasNextPage && (
              <button
                className='ops-button'
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage
                  ? 'Loading…'
                  : query.isFetchNextPageError
                  ? 'Retry loading orders'
                  : 'Load more'}
              </button>
            )}
            {query.isError && !query.isFetchNextPageError && (
              <p role='alert'>
                Orders could not refresh. Showing previous results.{' '}
                <button className='ops-button' onClick={() => void query.refetch()}>
                  Try again
                </button>
              </p>
            )}
          </>
        )}
    </section>
  )
}
