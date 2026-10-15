import type { WheretooMapEvent } from '../data/wheretooMapEvents'

export function reconcileSelectedEventId(
  selectedEventId: string | null,
  events: readonly WheretooMapEvent[],
) {
  return selectedEventId && events.some((event) => event.id === selectedEventId) ? selectedEventId : null
}
