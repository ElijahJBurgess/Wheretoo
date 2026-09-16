import { publicEnv } from '../../lib/env'
import { z } from 'zod'
import { supabase } from '../../lib/supabase/client'
import { validateImageContent, validateImageSelection } from './imageFiles'

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
export async function uploadEventImage(eventId: string, file: File, current: () => boolean = () => true): Promise<string> {
  validateImageSelection([file], 0)
  await validateImageContent(file)
  if (!current()) throw new Error('Your session changed. Sign in again before uploading.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session || !current()) throw new Error('Sign in again before uploading.')
  const response = await fetch(`${publicEnv.supabaseUrl}/functions/v1/event-images`, {
    method: 'POST', headers: { authorization: `Bearer ${session.access_token}`, apikey: publicEnv.supabasePublishableKey, 'content-type': file.type, 'x-event-id': eventId }, body: file,
  })
  if (!response.ok) throw new Error(response.status === 415 ? 'Choose a readable JPEG, PNG or WebP image.' : 'Upload could not be confirmed. Refresh flyer before trying again.')
  return z.object({ path: z.string().startsWith(`${eventId}/`) }).parse(await response.json()).path
}
export async function removeEventImage(path: string): Promise<void> {
  const { error } = await bucket().remove([path])
  if (error) throw new Error('Removal could not be confirmed. Refresh flyer before trying again.')
}
export async function reorderEventImages(eventId: string, ids: string[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_event_images', { p_event_id: eventId, p_image_ids: ids })
  if (error) throw new Error('The flyer changed or could not be saved. Refresh flyer and try again.')
}
