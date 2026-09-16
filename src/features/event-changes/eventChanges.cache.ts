import type { QueryClient } from '@tanstack/react-query'
import { eventKeys } from '../events/event.queries'
import { moderationKeys } from '../moderation/moderation.queries'
import type { EventChangeContext } from './eventChanges.schemas'
export function adoptEventChangeCache(client: QueryClient, context: EventChangeContext) {
 const ownerId = context.event.organizer_id
 const eventId = context.event_id
 client.setQueryData(['event-change-context', ownerId, eventId], context)
 client.setQueryData(eventKeys.detail(ownerId, eventId), context.event)
 client.setQueryData(moderationKeys.requirements(ownerId, eventId), context.requirements)
 for (const queryKey of [eventKeys.ownedList(ownerId), moderationKeys.agreement(ownerId, eventId), moderationKeys.review(ownerId, eventId), moderationKeys.publicEvent(eventId)]) {
  // Cache refresh is a handoff concern. It must never replace the displayed editor token.
  void client.invalidateQueries({ queryKey, exact: true })
 }
}
