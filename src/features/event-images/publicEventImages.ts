import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { publicEnv } from '../../lib/env'
import { imageRecordSchema, type EventImage } from './imageRecords'

export async function listPublicEventImages(eventIds: string[], signal?: AbortSignal): Promise<EventImage[]> {
  const images: EventImage[] = []
  for (let offset=0; offset<eventIds.length; offset+=100) {
    const response = await fetch(`${publicEnv.supabaseUrl}/rest/v1/rpc/list_event_images`, {
      method: 'POST', signal, credentials: 'omit',
      headers: { apikey: publicEnv.supabasePublishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ p_event_ids: eventIds.slice(offset,offset+100) }),
    })
    if (!response.ok) throw new Error('Event images could not load.')
    images.push(...z.array(imageRecordSchema).parse(await response.json()).map(image => ({
      ...image, url: `${publicEnv.supabaseUrl}/functions/v1/event-images?id=${image.id}`,
    })))
  }
  return images
}
export function usePublicEventImages(ids: readonly string[]) {
  const eventIds=[...new Set(ids.filter(Boolean))].sort()
  return useQuery({ queryKey:['public-event-images',eventIds], queryFn:({signal})=>listPublicEventImages(eventIds,signal),
    enabled:eventIds.length>0, staleTime:0, gcTime:0, refetchInterval:40_000, retry:false })
}
