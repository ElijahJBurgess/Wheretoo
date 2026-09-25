import { z } from 'zod'
import { supabase } from '../../lib/supabase/client'
import { organizerInputSchema, type OrganizerInput } from './organizer.schemas'

export async function saveProfile(userId: string, input: OrganizerInput, expectedUpdatedAt: string | null, logoId: string | null, isCurrent: () => boolean) {
  const profile = organizerInputSchema.parse(input)
  const { data, error } = await supabase.auth.getSession()
  if (error || data.session?.user.id !== userId || !isCurrent()) throw new Error('Your session changed. Sign in again.')
  const result = await supabase.rpc('save_owned_organizer_setup', {
    p_profile: profile, p_expected_updated_at: expectedUpdatedAt, p_logo_id: logoId,
  }).setHeader('Authorization', `Bearer ${data.session.access_token}`)
  if (!isCurrent()) throw new Error('Your session changed. Sign in again.')
  if (result.error) throw new Error(result.error.message === 'ORGANIZER_SETTINGS_CONFLICT'
    ? 'Your profile changed elsewhere. Review the latest saved profile before saving again.'
    : result.error.code === 'PGRST202'
      ? 'Organizer profile setup is not available in this environment yet. Please try again after the service is updated.'
      : 'Your profile could not be saved. Your changes are still here. Try again.')
  return z.object({ updatedAt: z.iso.datetime({ offset: true }) }).parse(result.data)
}
