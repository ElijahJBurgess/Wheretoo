import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { type FreeRsvpEvent, rsvpApi } from './rsvp.api'
export function FreeRsvpEntry({ eventId }: { eventId: string }) {
  const [value, setValue] = useState<{ eventId: string; data: FreeRsvpEvent | null } | null>(null)
  const [error, setError] = useState(false)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let active = true
    void rsvpApi.event(eventId).then((data) => {
      if (active) {
        setValue({ eventId, data })
        setError(false)
      }
    }, () => {
      if (active) setError(true)
    })
    return () => {
      active = false
    }
  }, [eventId, version])
  if (error) {
    return (
      <div role='status'>
        <p>Current RSVP availability could not be checked.</p>
        <button className='ui-button buyer-secondary' onClick={() => setVersion((v) => v + 1)}>
          Check availability
        </button>
      </div>
    )
  }
  if (value?.eventId !== eventId) return <p role='status'>Checking RSVP availability…</p>
  if (value.data === null) return <p>RSVP is currently unavailable.</p>
  if (value.data.availability.status === 'full') {
    return (
      <div className='rsvp-notice'>
        <p>RSVP capacity reached</p>
        <button className='ui-button buyer-secondary' disabled>RSVP full</button>
      </div>
    )
  }
  return (
    <Link className='ui-button buyer-primary' to={'/events/' + eventId + '/rsvp'}>
      RSVP for free
    </Link>
  )
}
