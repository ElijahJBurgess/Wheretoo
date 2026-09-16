import { useEffect, useRef } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import type { AdmissionCursor, AdmissionPage, EventMetrics, OrderCursor, OrderFilter } from './operations.schemas'
import { getEventMetrics, getOrderDetails, listEventOrders, listEventAdmissions } from './operations.api'
import { isOperationsAccessDenied } from './operations.errors'
import { eventKeys } from '../events/event.queries'
import { getFreeRegistrationMetrics, listFreeAdmissions } from './freeOperations.api'
import type { FreeAdmissionCursor, FreeAdmissionsPage, FreeRegistrationMetrics } from './freeOperations.schemas'
export const operationsKeys = {
  event: (ownerId: string, eventId: string) => ['organizer-operations', ownerId, eventId] as const,
}
export function useEventMetrics(ownerId: string, eventId: string) {
  return useQuery<EventMetrics>({
    queryKey: [...operationsKeys.event(ownerId, eventId), 'metrics'],
    queryFn: () => getEventMetrics(eventId),
    enabled: !!ownerId && !!eventId,
  })
}

export function useOperationsMetrics(
  ownerId: string,
  eventId: string,
  sourceKind: 'paid_order' | 'free_registration',
  identityVersion = 0,
) {
  return useQuery<EventMetrics | FreeRegistrationMetrics>({
    queryKey: [...operationsKeys.event(ownerId, eventId), 'source', sourceKind, identityVersion, 'metrics'],
    queryFn: ({ signal }) => sourceKind === 'free_registration'
      ? getFreeRegistrationMetrics(eventId, signal)
      : getEventMetrics(eventId),
    enabled: !!ownerId && !!eventId,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  })
}

export function useEventOrders(ownerId: string, eventId: string, search: string, status: OrderFilter = 'all') {
  return useInfiniteQuery({
    queryKey: [...operationsKeys.event(ownerId, eventId), 'orders', search, status],
    initialPageParam: null as OrderCursor | null,
    queryFn: ({ pageParam }) => listEventOrders(eventId, search, pageParam, status),
    getNextPageParam: (page) => page.nextCursor,
    enabled: !!ownerId && !!eventId,
    // A cached key must revalidate on filter changes as well as component mounts.
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  })
}

export function useOrder(ownerId: string, eventId: string, orderId: string) {
  const client = useQueryClient()
  // V1 dialog reads cannot populate the V2 detail cache with incomplete snapshots.
  const query = useQuery({
    queryKey: [...operationsKeys.event(ownerId, eventId), 'order-v2', orderId],
    queryFn: () => getOrderDetails(eventId, orderId),
    enabled: !!ownerId && !!eventId && !!orderId,
    refetchOnMount: 'always',
    retry: false,
    // Read reconciliation outlives the dialog, including ambiguous request acknowledgments.
    // Poll only while visible and the order can still change; never initiate a mutation here.
    refetchInterval: q => isOperationsAccessDenied(q.state.error) ? false
      : q.state.data && ['refunded', 'expired', 'payment_failed', 'cancelled'].includes(q.state.data.status) ? false : 5000,
    refetchIntervalInBackground: false,
  })
  const observed = useRef('')
  const data = query.data
  const signature = data ? JSON.stringify([ownerId, eventId, orderId, data.status, data.refundState,
    data.tickets.map(ticket => [ticket.id, ticket.status, ticket.usedAt])]) : ''
  useEffect(() => {
    if (!signature || !query.isFetchedAfterMount || query.isError || observed.current === signature) return
    observed.current = signature
    // Canonical data, not request completion, updates inventory and list status.
    for (const key of [
      [...operationsKeys.event(ownerId, eventId), 'metrics'],
      [...operationsKeys.event(ownerId, eventId), 'orders'],
      eventKeys.ownedList(ownerId),
    ]) void client.invalidateQueries({ queryKey: key })
  }, [client, eventId, ownerId, signature, query.isFetchedAfterMount, query.isError])
  return query
}

export function useEventAdmissions(ownerId: string, eventId: string, search: string) {
  return useInfiniteQuery({
    queryKey: [...operationsKeys.event(ownerId, eventId), 'admissions', search],
    initialPageParam: null as AdmissionCursor | null,
    queryFn: ({ pageParam, signal }) => listEventAdmissions(eventId, search, pageParam, signal),
    getNextPageParam: page => page.nextCursor,
    enabled: !!ownerId && !!eventId && !!search.trim(),
    staleTime: 0, refetchOnMount: 'always', retry: false,
  })
}

export function useOperationsAdmissions(
  ownerId: string,
  eventId: string,
  sourceKind: 'paid_order' | 'free_registration',
  identityVersion: number,
  search: string,
) {
  type Page = AdmissionPage | FreeAdmissionsPage
  type Cursor = AdmissionCursor | FreeAdmissionCursor | null
  return useInfiniteQuery<Page, Error, InfiniteData<Page>, readonly unknown[], Cursor>({
    queryKey: [...operationsKeys.event(ownerId, eventId), 'source', sourceKind, identityVersion, 'admissions', search],
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) => sourceKind === 'free_registration'
      ? listFreeAdmissions(eventId, search, pageParam as FreeAdmissionCursor | null, signal)
      : listEventAdmissions(eventId, search, pageParam as AdmissionCursor | null, signal),
    getNextPageParam: page => page.nextCursor,
    enabled: !!ownerId && !!eventId && !!search.trim(),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  })
}
