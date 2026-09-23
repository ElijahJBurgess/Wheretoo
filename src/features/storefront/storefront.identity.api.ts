import { z } from 'zod'
import { supabase } from '../../lib/supabase/client'
import { publicEnv } from '../../lib/env'
import {
  validateImageContent,
  validateImageSelection,
} from '../event-images/imageFiles'
export const identitySchema = z.strictObject({
  handle: z.string().nullable(),
  logoId: z.uuid().nullable(),
  name: z.string(),
})
export async function readIdentity() {
  const { data, error } = await supabase.rpc('get_owned_storefront_identity')
  if (error) throw new Error('Your storefront identity could not load.')
  return data === null ? null : identitySchema.parse(data)
}
export async function handleAvailable(handle: string) {
  const { data, error } = await supabase.rpc('storefront_handle_available', {
    p_handle: handle,
  })
  if (error || typeof data !== 'boolean') {
    throw new Error('Handle availability could not be checked.')
  }
  return data
}
async function sessionToken(userId: string) {
  const { data } = await supabase.auth.getSession()
  if (!data.session || data.session.user.id !== userId) {
    throw new Error('Your session changed. Sign in again.')
  }
  return data.session.access_token
}
export async function uploadOrganizerMedia(
  file: File,
  userId: string,
  isCurrent: () => boolean = () => true,
): Promise<string> {
  validateImageSelection([file], 0)
  await validateImageContent(file)
  const token = await sessionToken(userId)
  if (!isCurrent()) throw new Error('Your session changed. Sign in again.')
  const response = await fetch(
    `${publicEnv.supabaseUrl}/functions/v1/organizer-media`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        apikey: publicEnv.supabasePublishableKey,
        'content-type': file.type,
      },
      body: file,
      referrerPolicy: 'no-referrer',
    },
  )
  if (!response.ok) {
    throw new Error('Image upload could not be confirmed. Try again.')
  }
  return z.strictObject({ id: z.uuid() }).parse(await response.json()).id
}
export async function confirmIdentity(
  handle: string,
  logoId: string,
  userId: string,
) {
  const token = await sessionToken(userId)
  const { data, error } = await supabase.rpc(
    'confirm_owned_storefront_handle',
    { p_handle: handle, p_logo_id: logoId },
  ).setHeader('Authorization', `Bearer ${token}`)
  if (error) {
    throw new Error(
      error.message === 'HANDLE_TAKEN'
        ? 'That handle was just claimed. Choose another.'
        : error.message === 'HANDLE_IMMUTABLE'
        ? 'Your confirmed handle cannot change.'
        : 'Your identity could not be confirmed. Keep your details and try again.',
    )
  }
  return z.strictObject({ handle: z.string(), confirmedAt: z.string() }).parse(
    data,
  )
}
export function organizerMediaUrl(id: string) {
  return `${publicEnv.supabaseUrl}/functions/v1/organizer-media?id=${
    encodeURIComponent(id)
  }`
}

export async function clearUnusedOrganizerMedia(
  userId: string,
  isCurrent: () => boolean,
) {
  const token = await sessionToken(userId)
  if (!isCurrent()) throw new Error('Session changed.')
  const response = await fetch(
    `${publicEnv.supabaseUrl}/functions/v1/organizer-media`,
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
        apikey: publicEnv.supabasePublishableKey,
      },
      referrerPolicy: 'no-referrer',
    },
  )
  if (!response.ok) {
    throw new Error('Unused uploads could not be cleared. Try again.')
  }
}
