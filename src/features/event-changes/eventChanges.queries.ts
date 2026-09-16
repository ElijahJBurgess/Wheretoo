import { useQuery } from '@tanstack/react-query'
import { getEventChangeContext, getEventNoticeStatus, getCancellationSummary } from './eventChanges.api'
import type { NoticePurpose } from './eventChanges.schemas'
export const eventChangeKeys = {
 context: (ownerId: string, eventId: string) => ['event-change-context', ownerId, eventId] as const,
 notice: (ownerId: string, eventId: string, purpose: NoticePurpose) => ['event-notice-status', ownerId, eventId, purpose] as const,
 summary: (ownerId: string, eventId: string) => ['event-cancellation-summary', ownerId, eventId] as const,
}
export function useEventChangeContext(eventId: string, ownerId: string) {
 return useQuery({ queryKey: eventChangeKeys.context(ownerId, eventId), queryFn: ({ signal }) => getEventChangeContext(eventId, ownerId, signal), enabled: !!eventId && !!ownerId, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false })
}
export function useEventNoticeStatus(eventId: string, ownerId: string, purpose: NoticePurpose) {
 return useQuery({ queryKey: eventChangeKeys.notice(ownerId, eventId, purpose), queryFn: ({ signal }) => getEventNoticeStatus(eventId, purpose, signal), enabled: !!eventId && !!ownerId, retry: false })
}
export function useCancellationSummary(eventId: string, ownerId: string) {
 return useQuery({ queryKey: eventChangeKeys.summary(ownerId, eventId), queryFn: ({ signal }) => getCancellationSummary(eventId, signal), enabled: !!eventId && !!ownerId, retry: false })
}
