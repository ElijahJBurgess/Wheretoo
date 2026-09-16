import { useOutletContext } from 'react-router-dom'
import type { EventRow } from '../events/event.types'
export type CheckInContext = {
  ownerId: string
  identityVersion: number
  eventId: string
  event: EventRow
  sourceKind: 'paid_order' | 'free_registration'
  search: string
  setSearch(value: string): void
}
export const useCheckInContext = () => useOutletContext<CheckInContext>()
