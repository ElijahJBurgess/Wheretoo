import type { User, UserAttributes } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase/client'
import { createIsolatedAccountClient } from './isolatedAccountClient'

export type AccountIdentity = {
  id: string
  fullName: string
  email: string | null
  emailConfirmedAt: string | null
  pendingEmail: string | null
  emailChangeSentAt: string | null
}
export type AccountErrorCode = 'session_expired' | 'rate_limited' | 'reauthentication_required' | 'password_refused' | 'provider_failure' | 'invalid_input'
const messages: Record<AccountErrorCode, string> = {
  session_expired: 'Your account session has changed or expired. Sign in again to continue.',
  rate_limited: 'Too many attempts. Wait a little before trying again.',
  reauthentication_required: 'Confirm your identity using a verification code before changing your password.',
  password_refused: 'The password was not accepted. Choose a different password that meets your account security requirements.',
  provider_failure: 'Your account could not be updated or refreshed. Please try again.',
  invalid_input: 'Check the entered details and try again.',
}
export class AccountSecurityError extends Error {
  constructor(public readonly code: AccountErrorCode) { super(messages[code]); this.name = 'AccountSecurityError' }
}
export function safeAccountError(error: unknown): AccountSecurityError {
  if (error instanceof AccountSecurityError) return error
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  const name = error && typeof error === 'object' && 'name' in error ? error.name : null
  const status = error && typeof error === 'object' && 'status' in error ? error.status : null
  if (status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return new AccountSecurityError('rate_limited')
  if (name === 'AuthSessionMissingError' || status === 401 || code === 'session_not_found' || code === 'session_expired' || code === 'refresh_token_not_found' || code === 'bad_jwt' || code === 'user_not_found') return new AccountSecurityError('session_expired')
  if (code === 'reauthentication_needed' || code === 'reauthentication_not_valid') return new AccountSecurityError('reauthentication_required')
  if (code === 'weak_password' || code === 'same_password') return new AccountSecurityError('password_refused')
  if (code === 'validation_failed') return new AccountSecurityError('invalid_input')
  return new AccountSecurityError('provider_failure')
}
function projectUser(user: User, expectedUserId: string): AccountIdentity {
  if (!expectedUserId || user.id !== expectedUserId) throw new AccountSecurityError('session_expired')
  return {
    id: user.id,
    fullName: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : '',
    email: user.email || null,
    emailConfirmedAt: user.email_confirmed_at || null,
    pendingEmail: user.new_email && user.new_email !== user.email ? user.new_email : null,
    emailChangeSentAt: user.email_change_sent_at || null,
  }
}
export async function getAccountIdentity(userId: string, isCurrent: () => boolean = () => true): Promise<AccountIdentity> {
  try {
    return await withIsolatedClient(userId, isCurrent, async (_client, user) => projectUser(user, userId))
  } catch (error) { throw safeAccountError(error) }
}
async function withIsolatedClient<T>(userId: string, isCurrent: () => boolean, operation: (client: Awaited<ReturnType<typeof createIsolatedAccountClient>>, user: User) => Promise<T>): Promise<T> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session || data.session.user.id !== userId || !isCurrent()) throw new AccountSecurityError('session_expired')
  const client = await createIsolatedAccountClient(data.session)
  try {
    const { data: fresh, error: readError } = await client.auth.getUser()
    if (readError) throw readError
    if (!fresh.user || fresh.user.id !== userId || !isCurrent()) throw new AccountSecurityError('session_expired')
    return await operation(client, fresh.user)
  } finally {
    // The SDK registers browser listeners even when automatic refresh is disabled.
    await client.auth.dispose()
  }
}
async function updateAccount(userId: string, attributes: UserAttributes, isCurrent: () => boolean, emailRedirectTo?: string): Promise<AccountIdentity> {
  try {
    return await withIsolatedClient(userId, isCurrent, async isolated => {
      if (!isCurrent()) throw new AccountSecurityError('session_expired')
      const { data, error } = emailRedirectTo
        ? await isolated.auth.updateUser(attributes, { emailRedirectTo })
        : await isolated.auth.updateUser(attributes)
      if (error) throw error
      if (!isCurrent() || !data.user) throw new AccountSecurityError('session_expired')
      return projectUser(data.user, userId)
    })
  } catch (error) { throw safeAccountError(error) }
}
export function updateAccountName(userId: string, fullName: string, isCurrent: () => boolean = () => true): Promise<AccountIdentity> {
  const name = fullName.trim()
  if (!name || name.length > 120) return Promise.reject(new AccountSecurityError('invalid_input'))
  return updateAccount(userId, { data: { full_name: name } }, isCurrent)
}
export function changeAccountEmail(userId: string, email: string, isCurrent: () => boolean = () => true): Promise<AccountIdentity> {
  const normalized = email.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) return Promise.reject(new AccountSecurityError('invalid_input'))
  return updateAccount(userId, { email: normalized }, isCurrent, `${window.location.origin}/organizer/settings/account`)
}
/** Called directly from component memory; never use a cached mutation for passwords. */
export async function changeAccountPassword(userId: string, password: string, nonce?: string, isCurrent: () => boolean = () => true): Promise<void> {
  if (!password) throw new AccountSecurityError('invalid_input')
  await updateAccount(userId, nonce ? { password, nonce } : { password }, isCurrent)
}
export async function requestPasswordReauthentication(userId: string, isCurrent: () => boolean = () => true): Promise<void> {
  try {
    await withIsolatedClient(userId, isCurrent, async isolated => {
      if (!isCurrent()) throw new AccountSecurityError('session_expired')
      const { error } = await isolated.auth.reauthenticate()
      if (error) throw error
      if (!isCurrent()) throw new AccountSecurityError('session_expired')
    })
  } catch (error) { throw safeAccountError(error) }
}
