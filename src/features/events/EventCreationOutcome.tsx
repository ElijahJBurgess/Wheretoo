import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { EventCreationLayout } from './EventCreationLayout'

export function EventCreationOutcome({ eventId, state, onCheck }: { eventId: string; state: 'live' | 'review' | 'unavailable' | 'unknown' | 'loading'; onCheck?: () => void }) {
  const title = state === 'live' ? 'Your event is live!' : state === 'review' ? 'Your event is under review' : state === 'unknown' ? 'Public availability unconfirmed' : state === 'loading' ? 'Checking public availability…' : 'Your event is currently unavailable'
  return <EventCreationLayout title={title} step={8}>
    <div className="creation-outcome" aria-live="polite">
      <h1>{title}</h1>
      <p>{state === 'live' ? 'Your event is publicly available. Share it with your community.' : state === 'unknown' ? 'Publication was saved, but public availability could not be checked. Check again to confirm its status.' : state === 'loading' ? 'Publication was saved. We are checking its current availability.' : 'Publication was saved. Your event is not currently publicly available. View event status for details.'}</p>
      <div className="creation-outcome__actions">
        {state === 'live' ? <><Link className="ui-button ui-button--primary" to={`/events/${eventId}`}>View event</Link><Link className="ui-button ui-button--secondary" to={`/organizer/events/${eventId}/dashboard`}>Go to dashboard</Link></> : null}
        {state === 'unknown' && onCheck ? <Button onClick={onCheck}>Check public availability again</Button> : null}
        <Link className="ui-button ui-button--secondary" to={`/organizer/events/${eventId}`}>Event status</Link>
        <Link className="ui-button ui-button--secondary" to="/organizer/events/new">Create another event</Link>
        <Link className="ui-button ui-button--secondary" to="/organizer/events">My Events</Link>
      </div>
    </div>
  </EventCreationLayout>
}
