import type { OrderSummary } from './operations.schemas'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { useEventMetrics, useEventOrders } from './operations.queries'
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
  const [previousRows, setPreviousRows] = useState<OrderSummary[]>([])
  const query = useEventOrders(ownerId, eventId, search)
  const metrics = useEventMetrics(ownerId, eventId)
  const rows = query.data?.pages.flatMap((page) => page.orders) ?? previousRows
  return (
    <section className='operations-page'>
      <Link className='ops-back' to={`/organizer/events/${eventId}/dashboard`}>
        ← Event dashboard
      </Link>
      <header className='ops-page-heading'>
        <p>{metrics.data?.event.title ?? 'Event operations'}</p>
        <h1>Orders</h1>
        <p>Manage and view ticket orders for this event.</p>
      </header>
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
      {query.isPending && rows.length === 0
        ? <p role='status' className='operations-state'>Loading orders…</p>
        : query.isError && !query.data && rows.length === 0
        ? <OperationsError title='Orders unavailable' retry={() => void query.refetch()} />
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
                    <span>{order.quantity} tickets</span>
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
              <p className='operations-state'>
                {search ? 'No matching orders.' : 'No orders yet.'}
              </p>
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
