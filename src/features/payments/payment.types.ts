import type { Database } from '../../lib/supabase/database.types'

type OrganizerStripeAccountRow = Database['public']['Tables']['organizer_stripe_accounts']['Row']

type ConnectStatusSummary = Pick<
  OrganizerStripeAccountRow,
  | 'requirements_currently_due_count'
  | 'requirements_past_due_count'
  | 'last_status_code'
  | 'last_synced_at'
>

export type ConnectStatus =
  | { status: 'not_started' }
  | ({ status: 'pending' } & ConnectStatusSummary)
  | ({ status: 'action_required' } & ConnectStatusSummary)
  | ({ status: 'restricted' } & ConnectStatusSummary)
  | ({ status: 'ready' } & ConnectStatusSummary)
