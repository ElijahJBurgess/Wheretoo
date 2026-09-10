import { useQuery } from '@tanstack/react-query'
import { getEventMetrics } from './operations.api'
export const operationsKeys = {
  event: (ownerId: string, eventId: string) => ['organizer-operations', ownerId, eventId] as const,
}
export function useEventMetrics(ownerId: string, eventId: string) {
  return useQuery({
    queryKey: [...operationsKeys.event(ownerId, eventId), 'metrics'],
    queryFn: () => getEventMetrics(eventId), enabled: !!ownerId && !!eventId,
  })
}
