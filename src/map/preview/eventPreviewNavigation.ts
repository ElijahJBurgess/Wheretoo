import { z } from 'zod'

export type EventPreviewNavigation =
  | { kind: 'enabled'; to: string }
  | { kind: 'disabled'; indication: string; explanation: string }
  | { kind: 'unavailable' }

export function resolveEventPreviewNavigation(eventId: string): EventPreviewNavigation {
  const parsed = z.uuid().safeParse(eventId)
  if (!parsed.success) return { kind: 'unavailable' }
  return { kind: 'enabled', to: `/events/${parsed.data.toLowerCase()}` }
}
