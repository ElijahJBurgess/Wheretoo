import { z } from 'zod'
import { supabase } from '../../lib/supabase/client'
import { organizerInputSchema } from '../organizers/organizer.schemas'

export const settingsProfileInputSchema = z.strictObject({
  displayName: organizerInputSchema.shape.displayName,
  bio: z.string().max(500),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
})
export type SettingsProfileInput = z.infer<typeof settingsProfileInputSchema>
export type SettingsProfile = { displayName: string; bio: string; updatedAt: string }
const profileResponse = z.strictObject({
  display_name: z.string().min(2).max(100),
  bio: z.string().max(500).nullable(),
  updated_at: z.iso.datetime({ offset: true }),
})
export class SettingsProfileError extends Error {
  constructor(readonly code: 'conflict' | 'invalid' | 'session' | 'unavailable') {
    super({ conflict: 'Your profile changed elsewhere. Review the latest saved profile before saving again.', invalid: 'Check your organizer name and bio.', session: 'Your session changed. Sign in again to continue.', unavailable: 'Your profile could not be saved. Your changes are still here.' }[code])
  }
}
export async function saveSettingsProfile(
  userId: string,
  input: SettingsProfileInput,
  isCurrent: () => boolean = () => true,
): Promise<SettingsProfile> {
  const parsed = settingsProfileInputSchema.safeParse(input)
  if (!parsed.success) throw new SettingsProfileError('invalid')
  const { data: auth, error: authError } = await supabase.auth.getSession()
  if (authError || !auth.session || auth.session.user.id !== userId || !isCurrent()) throw new SettingsProfileError('session')
  // Bind the operation to its initiating session. A later account switch must
  // not cause the SDK's fetch-time token lookup to write these values as B.
  const { data, error } = await supabase.rpc('save_owned_organizer_settings', {
    p_display_name: parsed.data.displayName,
    p_bio: parsed.data.bio,
    p_expected_updated_at: parsed.data.expectedUpdatedAt,
  }).setHeader('Authorization', `Bearer ${auth.session.access_token}`)
  if (!isCurrent()) throw new SettingsProfileError('session')
  if (error) {
    const code = error.message === 'ORGANIZER_SETTINGS_CONFLICT' ? 'conflict'
      : error.message === 'ORGANIZER_SETTINGS_INVALID' ? 'invalid'
        : error.code === '42501' || error.code === 'PGRST301' || error.message === 'ORGANIZER_NOT_FOUND' ? 'session' : 'unavailable'
    throw new SettingsProfileError(code)
  }
  const result = z.array(profileResponse).length(1).safeParse(data)
  if (!result.success) throw new SettingsProfileError('unavailable')
  const row = result.data[0]
  return { displayName: row.display_name, bio: row.bio ?? '', updatedAt: row.updated_at }
}
