import { ReadState } from '../../components/ui/ReadState'
import { useState } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import { z } from 'zod'
import { useSession } from '../auth/SessionProvider'
import { useOwnedEvent } from '../events/event.queries'
import type { CheckInContext } from './CheckInContext'
import './find-guest.css'

export function CheckInLayout() {
  const { eventId = '' } = useParams()
  const session = useSession()
  const ownerId = session.status === 'authenticated' ? session.user.id : ''
  if (!ownerId || !z.uuid().safeParse(eventId).success) return <ReadState headingAs='h1' status='unavailable' title='Event unavailable' />
  return <OwnedCheckIn key={`${ownerId}:${session.identityVersion ?? 0}:${eventId}`} ownerId={ownerId} identityVersion={session.identityVersion ?? 0} eventId={eventId} />
}
function OwnedCheckIn({ ownerId, identityVersion, eventId }: { ownerId: string; identityVersion: number; eventId: string }) {
  const query = useOwnedEvent(eventId, ownerId, { revalidateOnMount: true })
  const [search, setSearch] = useState('')
  if (query.isPending || !query.isFetchedAfterMount) return <ReadState headingAs='h1' paused={query.fetchStatus === 'paused'} status='loading' skeleton='detail-fields' title='Loading check-in…' />
  if (query.isError || !query.data) {
    return (
      <ReadState headingAs='h1' status='unavailable' title='Event unavailable' description='Your access and event details could not be confirmed.' action={<button className='ops-button' onClick={() => void query.refetch()}>Try again</button>} secondaryAction={<Link to='/organizer/events'>My events</Link>} />
    )
  }
  return (
    <Outlet
      context={{ ownerId, identityVersion, eventId, event: query.data, sourceKind: query.data.admission_type === 'free' ? 'free_registration' : 'paid_order', search, setSearch } satisfies CheckInContext}
    />
  )
}
