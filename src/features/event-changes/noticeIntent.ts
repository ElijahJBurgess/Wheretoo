import { z } from 'zod'
import { noticePreviewSchema, type NoticePreview, type NoticePurpose } from './eventChanges.schemas'
const schema = z.strictObject({ requestId: z.string().uuid(), preview: noticePreviewSchema })
export type NoticeIntent = z.infer<typeof schema>
function key(ownerId: string, eventId: string, purpose: NoticePurpose) { return `wheretoo:event-notice:v1:${ownerId}:${eventId}:${purpose}` }
export function readNoticeIntent(ownerId: string, eventId: string, purpose: NoticePurpose): NoticeIntent | null {
 try {
  const value = schema.safeParse(JSON.parse(sessionStorage.getItem(key(ownerId, eventId, purpose)) ?? 'null'))
  return value.success && value.data.preview.eventId === eventId && value.data.preview.purpose === purpose ? value.data : null
 } catch { return null }
}
export function rememberNoticeIntent(ownerId: string, preview: NoticePreview): NoticeIntent {
 const existing = readNoticeIntent(ownerId, preview.eventId, preview.purpose)
 if (existing?.preview.previewToken === preview.previewToken) return existing
 const intent = { requestId: crypto.randomUUID(), preview }
 // A durable identity is required before starting a potentially ambiguous submission.
 sessionStorage.setItem(key(ownerId, preview.eventId, preview.purpose), JSON.stringify(intent))
 return intent
}
export function clearNoticeIntent(ownerId: string, eventId: string, purpose: NoticePurpose) { sessionStorage.removeItem(key(ownerId, eventId, purpose)) }
