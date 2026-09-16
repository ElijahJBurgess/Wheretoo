import { publicEnv } from '../../lib/env'
import { authStorageKey, passwordAuthTransition, signOutExpectedSession, type SignOutIdentity } from './authTransitions'
import { supabase } from '../../lib/supabase/client'
import type { SignInInput, SignUpInput } from './auth.schemas'

export async function signUpOrganizer(input: SignUpInput): Promise<{ needsEmailConfirmation: boolean }> {
  const { data, error } = await passwordAuthTransition(supabase.auth, authStorageKey(publicEnv.supabaseUrl), () => supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { full_name: input.fullName },
      emailRedirectTo: `${window.location.origin}/organizer/setup`,
    },
  }))

  if (error) {
    throw error
  }

  return { needsEmailConfirmation: data.session === null }
}

export async function signInOrganizer(input: SignInInput): Promise<void> {
  const { error } = await passwordAuthTransition(supabase.auth, authStorageKey(publicEnv.supabaseUrl), () => supabase.auth.signInWithPassword(input))

  if (error) {
    throw error
  }
}

export function signOut(expected: SignOutIdentity, isCurrent: () => boolean = () => true) {
  // Copy at invocation so a later caller mutation cannot retarget this logout.
  const identity = { user: { id: expected.user.id }, access_token: expected.access_token, refresh_token: expected.refresh_token }
  return signOutExpectedSession(publicEnv, identity, isCurrent)
}
