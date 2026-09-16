import { getOwnedEvent } from '../events/event.api'
export async function reconcileCancellation(eventId: string, ownerId: string): Promise<'cancelled' | 'published' | 'unknown'> {
 try {
  // An actual owner read is required; cached query data cannot establish safe retry.
  const event = await getOwnedEvent(eventId, ownerId)
  if (event?.id !== eventId || event.organizer_id !== ownerId) return 'unknown'
  return event.status === 'cancelled' || event.status === 'published' ? event.status : 'unknown'
 } catch { return 'unknown' }
}
