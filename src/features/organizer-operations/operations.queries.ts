import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { OrderCursor } from './operations.schemas'
import { getEventMetrics, getOrder, listEventOrders } from './operations.api'
export const operationsKeys = {
  event: (ownerId: string, eventId: string) => ['organizer-operations', ownerId, eventId] as const,
}
export function useEventMetrics(ownerId: string, eventId: string) {
  return useQuery({
    queryKey: [...operationsKeys.event(ownerId, eventId), 'metrics'],
    queryFn: () => getEventMetrics(eventId),
    enabled: !!ownerId && !!eventId,
  })
}

export function useEventOrders(ownerId: string, eventId: string, search: string) {
  return useInfiniteQuery({
    queryKey: [...operationsKeys.event(ownerId, eventId), 'orders', search],
    initialPageParam: null as OrderCursor | null,
    queryFn: ({ pageParam }) => listEventOrders(eventId, search, pageParam),
    getNextPageParam: (page) => page.nextCursor,
    enabled: !!ownerId && !!eventId,
  })
}

export function useOrder(ownerId: string, eventId: string, orderId: string) {
  return useQuery({
    queryKey: [...operationsKeys.event(ownerId, eventId), 'order', orderId],
    queryFn: () => getOrder(eventId, orderId),
    enabled: !!ownerId && !!eventId && !!orderId,
  })
}
