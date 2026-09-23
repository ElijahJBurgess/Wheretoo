import { supabase } from '../../lib/supabase/client'
import {
  editorInputSchema,
  editorSchema,
  type StorefrontInput,
} from './storefront.editor'
import {
  type StorefrontCursor,
  storefrontDocumentSchema,
} from './storefront.schemas'
export async function readEditor() {
  const { data, error } = await supabase.rpc('get_owned_storefront_editor')
  if (error || !data) throw new Error('Storefront settings could not load.')
  return editorSchema.parse(data)
}
export async function readPreview(
  cursor: StorefrontCursor | null = null,
  limit = 5,
) {
  const { data, error } = await supabase.rpc('get_owned_storefront_preview', {
    p_cursor: cursor,
    p_limit: limit,
  })
  if (error || !data) throw new Error('Preview could not load.')
  return storefrontDocumentSchema.parse(data)
}
function writeError(message: string) {
  return new Error(
    message === 'STOREFRONT_CONFLICT'
      ? 'Your storefront changed elsewhere. Reload the saved version before saving again.'
      : message === 'STOREFRONT_PUBLISH_REQUIREMENTS'
      ? 'Confirm your handle, add your logo, and publish at least one eligible event first.'
      : message === 'FEATURED_EVENT_NOT_OWNED'
      ? 'Choose one of your own events.'
      : 'Your changes could not be saved. Your draft is still here.',
  )
}
async function token(userId: string, isCurrent: () => boolean) {
  const { data } = await supabase.auth.getSession()
  if (!data.session || data.session.user.id !== userId || !isCurrent()) {
    throw new Error('Your session changed. Sign in again.')
  }
  return data.session.access_token
}
export async function saveStorefront(
  input: StorefrontInput,
  updatedAt: string,
  userId: string,
  isCurrent: () => boolean,
) {
  const jwt = await token(userId, isCurrent)
  const { data, error } = await supabase.rpc('save_owned_storefront', {
    p_input: editorInputSchema.parse(input),
    p_expected_updated_at: updatedAt,
  }).setHeader('Authorization', `Bearer ${jwt}`)
  if (!isCurrent()) throw new Error('Your session changed.')
  if (error) throw writeError(error.message)
  return editorSchema.parse(data)
}
export async function publishStorefront(
  published: boolean,
  updatedAt: string,
  userId: string,
  isCurrent: () => boolean,
) {
  const jwt = await token(userId, isCurrent)
  const { data, error } = await supabase.rpc('set_owned_storefront_published', {
    p_published: published,
    p_expected_updated_at: updatedAt,
  }).setHeader('Authorization', `Bearer ${jwt}`)
  if (!isCurrent()) throw new Error('Your session changed.')
  if (error) throw writeError(error.message)
  return editorSchema.parse(data)
}
