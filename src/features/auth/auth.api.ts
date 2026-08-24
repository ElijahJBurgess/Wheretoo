import { supabase } from '../../lib/supabase/client'
import type { SignInInput, SignUpInput } from './auth.schemas'

export async function signUpOrganizer(input: SignUpInput): Promise<{ needsEmailConfirmation: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { full_name: input.fullName },
      emailRedirectTo: `${window.location.origin}/organizer/setup`,
    },
  })

  if (error) {
    throw error
  }

  return { needsEmailConfirmation: data.session === null }
}

export async function signInOrganizer(input: SignInInput): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword(input)

  if (error) {
    throw error
  }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()

  if (error) {
    throw error
  }
}
