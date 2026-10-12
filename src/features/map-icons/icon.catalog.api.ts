import { z } from 'zod'
import { supabase } from '../../lib/supabase/client'
import { parseIconResponse } from './icon.api'

const catalogSchema = z.strictObject({ catalogRevision: z.number().int().nonnegative(), selectionEnabled: z.boolean(), icons: z.array(z.unknown()).max(50) })
const versionIdentity = z.object({ versionId: z.uuid() })
const assignmentSchema = z.strictObject({ versionId: z.uuid().nullable(), name: z.string().min(1).max(100), state: z.enum(['default', 'validated', 'approved', 'published', 'retired', 'revoked']), descriptor: z.unknown().nullable() })

export async function listSelectableMapIcons(after: string | null) {
  const { data, error } = await supabase.rpc('list_selectable_map_icons', { p_limit: 50, ...(after ? { p_after: after } : {}) })
  if (error) throw error
  const page = catalogSchema.parse(data)
  const ids = page.icons.flatMap(raw => { const p = versionIdentity.safeParse(raw); return p.success ? [p.data.versionId] : [] })
  const icons = parseIconResponse({ catalogRevision: page.catalogRevision, renderingEnabled: page.selectionEnabled, versions: page.icons }, ids, import.meta.env.VITE_SUPABASE_URL)
  const last = versionIdentity.safeParse(page.icons.at(-1))
  return { ...page, icons, nextCursor: page.selectionEnabled && page.icons.length === 50 && last.success ? last.data.versionId : null }
}

export async function getOwnedEventMapIcon(eventId: string) {
  const { data, error } = await supabase.rpc('get_owned_event_map_icon', { p_event_id: eventId })
  if (error) throw error
  const current = assignmentSchema.parse(data)
  const descriptor = current.versionId && ['published', 'retired'].includes(current.state)
    ? parseIconResponse({ catalogRevision: 0, renderingEnabled: true, versions: [current.descriptor] }, [current.versionId], import.meta.env.VITE_SUPABASE_URL)[0] ?? null : null
  return { ...current, descriptor }
}
