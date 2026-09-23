import { z } from 'zod'
import { publicEnv } from '../../lib/env'
import { supabase } from '../../lib/supabase/client'

type CoverMutation = { file: File } | { remove: true } | { generationId: string; slot: number }
export async function mutateCover(eventId: string, revision: number, mutation: CoverMutation, current: () => boolean): Promise<void> {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Refresh flyer before trying again.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session || !current()) throw new Error('Your session changed. Sign in again before changing your flyer.')
  const upload = 'file' in mutation
  const response = await fetch(`${publicEnv.supabaseUrl}/functions/v1/event-images`, {
    method: upload ? 'POST' : 'PUT',
    headers: {
      authorization: `Bearer ${session.access_token}`, apikey: publicEnv.supabasePublishableKey,
      'content-type': upload ? mutation.file.type : 'application/json',
      'x-event-id': eventId, 'x-cover-revision': String(revision), 'x-request-id': crypto.randomUUID(),
    },
    body: upload ? mutation.file : JSON.stringify(mutation),
  })
  if (!response.ok) throw new Error(response.status === 415 ? 'Choose a readable JPEG, PNG or WebP image.' : 'Your flyer could not be confirmed. Refresh flyer before trying again.')
  z.object({ revision: z.number().int().nonnegative() }).parse(await response.json())
}
