import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { eventKeys } from '../events/event.queries'
import {
  acceptCurrentEventPolicies,
  getModerationCase,
  getMyStaffRole,
  getOwnedEventRequirements,
  getPublicEvent,
  getRequiredEventPolicies,
  listModerationQueue,
  reportPublicEvent,
  requestEventReview,
  saveEventRequirements,
  submitModerationAction,
  withdrawEventReview,
} from './moderation.api'
import type { EventRequirementsInput, ModerationActionInput, ReportReason } from './moderation.types'

export const moderationKeys = {
  policies: ['moderation', 'policies'] as const,
  requirements: (organizerId: string, eventId: string) => ['moderation', 'requirements', organizerId, eventId] as const,
  agreement: (organizerId: string, eventId: string) => ['moderation', 'agreement', organizerId, eventId] as const,
  review: (organizerId: string, eventId: string) => ['moderation', 'review', organizerId, eventId] as const,
  staffRole: (staffUserId: string) => ['moderation', 'staff-role', staffUserId] as const,
  queue: (staffUserId: string) => ['moderation', 'queue', staffUserId] as const,
  case: (staffUserId: string, eventId: string) => ['moderation', 'case', staffUserId, eventId] as const,
  publicEvent: (eventId: string) => ['public-event', eventId] as const,
}

export const moderationQueueLimit = 25

function exactInvalidation(queryClient: ReturnType<typeof useQueryClient>, queryKeys: readonly (readonly unknown[])[]) {
  return Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey, exact: true })))
}

export function useRequiredEventPolicies() {
  return useQuery({ queryKey: moderationKeys.policies, queryFn: getRequiredEventPolicies })
}

export function useOwnedEventRequirements(organizerId: string, eventId: string) {
  return useQuery({
    queryKey: moderationKeys.requirements(organizerId, eventId),
    queryFn: () => getOwnedEventRequirements(eventId),
    enabled: organizerId.length > 0 && eventId.length > 0,
  })
}

export function usePublicEvent(eventId: string) {
  return useQuery({ queryKey: moderationKeys.publicEvent(eventId), queryFn: () => getPublicEvent(eventId), enabled: eventId.length > 0 })
}

export function useSaveEventRequirements(organizerId: string, eventId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: EventRequirementsInput) => saveEventRequirements(eventId, input),
    onSuccess: async () => exactInvalidation(queryClient, [
      moderationKeys.requirements(organizerId, eventId), moderationKeys.agreement(organizerId, eventId),
      moderationKeys.review(organizerId, eventId), moderationKeys.publicEvent(eventId),
      eventKeys.detail(organizerId, eventId), eventKeys.ownedList(organizerId),
    ]),
  })
}

export function useAcceptCurrentEventPolicies(organizerId: string, eventId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => acceptCurrentEventPolicies(eventId),
    onSuccess: async () => exactInvalidation(queryClient, [
      moderationKeys.requirements(organizerId, eventId), moderationKeys.agreement(organizerId, eventId),
      moderationKeys.publicEvent(eventId),
    ]),
  })
}

export function useRequestEventReview(organizerId: string, eventId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (note: string) => requestEventReview(eventId, note),
    onSuccess: async () => exactInvalidation(queryClient, [
      moderationKeys.review(organizerId, eventId), moderationKeys.requirements(organizerId, eventId),
    ]),
  })
}

export function useWithdrawEventReview(organizerId: string, eventId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => withdrawEventReview(eventId),
    onSuccess: async () => exactInvalidation(queryClient, [
      moderationKeys.review(organizerId, eventId), moderationKeys.requirements(organizerId, eventId),
    ]),
  })
}

export function useStaffRole(staffUserId: string) {
  return useQuery({ queryKey: moderationKeys.staffRole(staffUserId), queryFn: getMyStaffRole, enabled: staffUserId.length > 0 })
}

export function useModerationQueue(staffUserId: string) {
  return useQuery({ queryKey: moderationKeys.queue(staffUserId), queryFn: () => listModerationQueue(moderationQueueLimit), enabled: staffUserId.length > 0 })
}

export function useModerationCase(staffUserId: string, eventId: string) {
  return useQuery({ queryKey: moderationKeys.case(staffUserId, eventId), queryFn: () => getModerationCase(eventId), enabled: staffUserId.length > 0 && eventId.length > 0 })
}

export function useSubmitModerationAction(staffUserId: string, organizerId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ModerationActionInput) => submitModerationAction(input),
    onSuccess: async (_actionId, input) => exactInvalidation(queryClient, [
      moderationKeys.case(staffUserId, input.eventId), moderationKeys.queue(staffUserId),
      moderationKeys.publicEvent(input.eventId), eventKeys.detail(organizerId, input.eventId),
      eventKeys.ownedList(organizerId),
    ]),
  })
}

export function useReportPublicEvent(eventId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason: ReportReason) => reportPublicEvent(eventId, reason),
    onSuccess: async () => exactInvalidation(queryClient, [moderationKeys.publicEvent(eventId)]),
  })
}
