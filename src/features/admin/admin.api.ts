import { supabase } from '../../lib/supabase/client'

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/admin/reset-password`,
  })
  if (error) throw new Error('We could not send the reset email. Please try again later.')
}
