import { supabase } from '../../lib/supabase/client'
import type { Database } from '../../lib/supabase/database.types'
import type { OrganizerInput } from './organizer.schemas'

export type Organizer = Pick<Database['public']['Tables']['organizers']['Row'], 'id'|'display_name'|'organizer_type'|'bio'|'website_url'|'base_city'|'country_code'|'onboarding_completed_at'|'created_at'|'updated_at'>
export const organizerColumns = 'id,display_name,organizer_type,bio,website_url,base_city,country_code,onboarding_completed_at,created_at,updated_at'

type OrganizerMutablePayload = Pick<
  Organizer,
  | 'display_name'
  | 'organizer_type'
  | 'bio'
  | 'website_url'
  | 'base_city'
  | 'country_code'
  | 'onboarding_completed_at'
>

function optionalText(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') {
    return null
  }

  return value
}

export async function getOrganizer(userId: string): Promise<Organizer | null> {
  const { data, error } = await supabase.from('organizers').select(organizerColumns).eq('id', userId).maybeSingle()

  if (error && error.code !== 'PGRST116') {
    throw error
  }

  return data ?? null
}

export async function saveOrganizer(userId: string, input: OrganizerInput): Promise<Organizer> {
  const existingOrganizer = await getOrganizer(userId)
  const mutablePayload: OrganizerMutablePayload = {
    display_name: input.displayName,
    organizer_type: optionalText(input.organizerType),
    bio: optionalText(input.bio),
    website_url: optionalText(input.websiteUrl),
    base_city: optionalText(input.baseCity),
    country_code: 'US',
    onboarding_completed_at: existingOrganizer?.onboarding_completed_at ?? null,
  }
  const { data, error } =
    existingOrganizer === null
      ? await supabase
          .from('organizers')
          .insert({
            id: userId,
            ...mutablePayload,
          })
          .select(organizerColumns)
          .single()
      : await supabase
          .from('organizers')
          .update(mutablePayload)
          .eq('id', userId)
          .select(organizerColumns)
          .single()

  if (error) {
    throw error
  }

  if (!data) {
    throw new Error('Organizer profile was not returned')
  }

  return data
}
