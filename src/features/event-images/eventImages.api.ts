import { publicEnv } from '../../lib/env'
import { z } from 'zod'
import { supabase } from '../../lib/supabase/client'

import { imageRecordSchema, type EventImage } from './imageRecords'
const bucket = () => supabase.storage.from('event-images')
export async function listEventImages(eventIds: string[]): Promise<EventImage[]> {
  if (!eventIds.length) return []
  if (eventIds.length > 100) {
    const pages: EventImage[] = []
    for (let offset = 0; offset < eventIds.length; offset += 100) pages.push(...await listEventImages(eventIds.slice(offset, offset + 100)))
    return pages
  }
  const { data, error } = await supabase.rpc('list_event_images', { p_event_ids: eventIds })
  if (error) throw error
  const records = z.array(imageRecordSchema).parse(data)
  if (!records.length) return []
  return resolveEventImages(records)
}
export async function resolveEventImages(records: z.infer<typeof imageRecordSchema>[]): Promise<EventImage[]> {
  const owned = records.filter(image => image.owned)
  const signed = owned.length ? await bucket().createSignedUrls(owned.map(image => image.path), 60) : null
  if (signed?.error) throw signed.error
  return records.map(image => {
    const url = image.owned ? signed?.data?.[owned.findIndex(row => row.id === image.id)]?.signedUrl
      : `${publicEnv.supabaseUrl}/functions/v1/event-images?id=${image.id}`
    if (!url) throw new Error('Images could not load.')
    return { ...image, url }
  })
}

export async function getEventCoverState(eventId: string): Promise<{ revision: number; latestGenerationId?: string | null; images: EventImage[] }> {
  const { data, error } = await supabase.rpc('get_event_cover_state', { p_event_id: eventId })
  if (error) throw error
  const state = z.object({ revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), latestGenerationId: z.string().uuid().nullable().optional(), images: z.array(imageRecordSchema) }).parse(data)
  return { revision: state.revision, latestGenerationId: state.latestGenerationId, images: await resolveEventImages(state.images) }
}
