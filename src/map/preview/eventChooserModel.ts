import type { WheretooMapEvent } from '../data/wheretooMapEvents'

export function sortEventsForChooser(events: readonly WheretooMapEvent[]) {
  return [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
}
