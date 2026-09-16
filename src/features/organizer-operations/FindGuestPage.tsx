import { ReadState } from '../../components/ui/ReadState'
import { isOperationsAccessDenied } from './operations.errors'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCheckInContext } from './CheckInContext'
import { useOperationsAdmissions } from './operations.queries'
export function FindGuestPage() {
  const { ownerId, identityVersion, eventId, sourceKind, search, setSearch } = useCheckInContext()
  const [draft, setDraft] = useState(search)
  const query = useOperationsAdmissions(ownerId, eventId, sourceKind, identityVersion, search)
  const failedRead = query.isError && (!query.isFetchNextPageError || isOperationsAccessDenied(query.error))
  const rows = failedRead ? [] : query.data?.pages.flatMap((page) => page.admissions.map(row => 'sourceKind' in row ? {
    ...row,
    sourceId: row.registrationId,
    attendeeName: row.registrantName,
    attendeeEmail: row.registrantEmail,
    reference: 'Free RSVP',
  } : {
    sourceKind: 'paid_order' as const,
    sourceId: row.orderId,
    attendeeName: row.buyerName,
    attendeeEmail: row.buyerEmail,
    reference: row.orderNumber,
    ...row,
  })) ?? []
  const names = new Map<string, string>()
  const multipleMatches = rows.some((row) => {
    const name = row.attendeeName.trim().toLocaleLowerCase()
    const previous = names.get(name)
    names.set(name, row.sourceId)
    return Boolean(name && previous && previous !== row.sourceId)
  })
  const base = `/organizer/events/${eventId}/check-in`
  return (
    <section className='find-guest'>
      <Link className='ops-back' to={base}>← Check-in</Link>
      <h1>Find Guest</h1>
      <p className='ops-muted'>Search by buyer name or email to look up and check in a guest.</p>
      <form
        className='find-guest__search'
        onSubmit={(e) => {
          e.preventDefault()
          setSearch(draft.trim())
          if (draft.trim() === search && search) void query.refetch()
        }}
      >
        <label className='sr-only' htmlFor='guest-search'>Search guest name or email</label>
        <input
          autoFocus
          id='guest-search'
          type='search'
          maxLength={320}
          placeholder='Search guest name or email'
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className='ops-button ops-button--primary' type='submit'>Search</button>
      </form>
      {search && (
        <div aria-live='polite'>
          {failedRead || (!query.isPending && query.isFetchedAfterMount && !query.data)
            ? (
              <ReadState status='unavailable' title='Search unavailable' description='We could not confirm the search results.'
                action={<button className='ops-button' onClick={() => void query.refetch()}>Try again</button>} />
            )
            : query.isPending || !query.isFetchedAfterMount
            ? <ReadState paused={query.fetchStatus === 'paused'} status='loading' skeleton='order-rows' title='Searching guests…' />
            : rows.length
            ? (
              <>
                <h2>
                  {multipleMatches
                    ? 'Multiple Results'
                    : rows.length > 1
                    ? 'Search Results'
                    : 'Search Result'}
                </h2>
                <p className='ops-note'>Select an individual ticket for “{search}”.</p>
                <ul className='find-guest__results'>
                  {rows.map((row) => (
                    <li key={row.ticketId}>
                      <Link to={row.sourceKind === 'free_registration'
                        ? `${base}/find/registrations/${row.sourceId}/${row.ticketId}`
                        : `${base}/find/${row.sourceId}/${row.ticketId}`}>
                        <div>
                          <strong>{row.attendeeName || 'Ticket holder'}</strong>
                          <span>{row.attendeeEmail}</span>
                          <span>{row.admissionLabel}</span>
                          <small>
                            Ticket {row.ticketPosition} of {row.ticketTotal} · {row.reference}
                          </small>
                        </div>
                        <span className={`ops-badge ops-badge--${row.status}`}>
                          {row.status === 'used' ? 'Already checked in' : row.status}
                        </span>
                        <span aria-hidden='true'>›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {query.isFetchNextPageError && <ReadState status='unavailable' title='More guests could not load' description='Showing the loaded results. Open a ticket to confirm its current admission status.' />}
                {query.hasNextPage && (
                  <button
                    className='ops-button'
                    disabled={query.isFetchingNextPage}
                    onClick={() => void query.fetchNextPage()}
                  >
                    {query.isFetchingNextPage ? 'Loading…' : query.isFetchNextPageError ? 'Retry loading guests' : 'Load more guests'}
                  </button>
                )}
              </>
            )
            : (
              <ReadState status='empty' title='No guest found' description='Try a different buyer name or email address.'
                action={<button className='ops-button ops-button--primary' onClick={() => { setDraft(''); setSearch(''); document.getElementById('guest-search')?.focus() }}>Try another search</button>} />
            )}
        </div>
      )}
      <Link className='ops-button find-guest__scanner' to={`${base}/scan`}>Back to scanner</Link>
    </section>
  )
}
