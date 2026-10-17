import { publicReturnState } from '../discovery/discovery.navigation'
import { Link, useLocation } from 'react-router-dom'
import { useFreeRsvpEvent } from './rsvp.queries'
export function FreeRsvpEntry({ eventId }: { eventId: string }) {
  const location = useLocation()
  const { data: event, isError: error, refetch } = useFreeRsvpEvent(eventId)
  if (error) {
    return (
      <div role='status'>
        <p>Current RSVP availability could not be checked.</p>
        <button className='ui-button buyer-secondary' onClick={() => void refetch()}>
          Check availability
        </button>
      </div>
    )
  }
  if (event === undefined) return <p role='status'>Checking RSVP availability…</p>
  if (event === null) return <p>RSVP is currently unavailable.</p>
  if (event.availability.status === 'full') {
    return (
      <div className='rsvp-notice'>
        <p>RSVP capacity reached</p>
        <button className='ui-button buyer-secondary' disabled>RSVP full</button>
      </div>
    )
  }
  return (
    <Link className='ui-button buyer-primary' to={'/events/' + eventId + '/rsvp'} state={publicReturnState(location.state)}>
      RSVP for free
    </Link>
  )
}
