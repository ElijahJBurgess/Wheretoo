import type { StripeIntegrationTestEnv } from './testEnv'

export const managedStripeProofActions = [
  'account_diagnostic',
  'server_proof',
  'setup',
  'inspect',
  'checkout_status',
  'deliver',
  'deliver_transient_retry',
  'expire_checkout',
  'invalid_signature',
  'reconcile_payment',
  'reconcile_events',
  'create_refund',
  'cleanup',
] as const

export type ManagedStripeProofAction = (typeof managedStripeProofActions)[number]

export type ManagedStripeProofClient = {
  invoke<T>(action: ManagedStripeProofAction, input?: Record<string, unknown>): Promise<T>
}

const unsafeValuePattern = /(?:https:\/\/checkout\.stripe\.com\/|(?:pk|rk|sk)_(?:test|live)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|sb_secret_[A-Za-z0-9])/i
const providerIdPattern = /^(?:acct|ch|fee|fr|evt|pi|price|prod|re|tr|trr|txn)_[A-Za-z0-9]+$|^cs_(?:test|live)_[A-Za-z0-9]+$/
const unsafeKeyPattern = /^(?:id|checkout_?url|confirmation_?bearer|authorization|service_?token|auth_?token|secret|buyer_?(?:email|name)|guest_?(?:email|name)|email|ticket_?id|order_?id|order_?item_?id|refund_?id|session_?id|payment_?intent_?id|charge_?id|transfer_?id|application_?fee_?id|balance_?transaction_?id|stripe_?(?:event|object)_?id|stripe_[a-z0-9_]*_id)$/i
const accountContractPredicateKeys = [
  'dashboard_is_express',
  'recipient_configuration_only',
  'default_currency_is_usd',
  'fees_collector_is_application',
  'losses_collector_is_application',
  'requirements_collector_is_stripe',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',')
}

function isFixedAccountDiagnostic(value: unknown): boolean {
  if (!isRecord(value)) return false
  const readyKeys = [
    'ok',
    'restricted_key_authenticated',
    'webhook_signature_verified',
    'livemode',
    'connected_account_matches',
    'transfers_status',
    'payouts_status',
    'requirements_status',
  ]
  if (hasExactKeys(value, readyKeys)) {
    const capabilityStatuses = new Set(['inactive', 'pending', 'active', 'restricted'])
    const requirementStatuses = new Set(['not_started', 'pending', 'action_required', 'restricted', 'clear'])
    const fixedTypes = typeof value.ok === 'boolean' &&
      typeof value.restricted_key_authenticated === 'boolean' &&
      typeof value.webhook_signature_verified === 'boolean' &&
      typeof value.livemode === 'boolean' &&
      typeof value.connected_account_matches === 'boolean' &&
      capabilityStatuses.has(value.transfers_status as string) &&
      capabilityStatuses.has(value.payouts_status as string) &&
      requirementStatuses.has(value.requirements_status as string)
    if (!fixedTypes) return false
    if (value.ok !== true) return true
    return value.restricted_key_authenticated === true &&
      value.webhook_signature_verified === true && value.livemode === false &&
      value.connected_account_matches === true && value.transfers_status === 'active' &&
      value.payouts_status === 'active' && value.requirements_status === 'clear'
  }
  if (value.ok !== false || typeof value.kind !== 'string') return false
  if (value.kind === 'ACCOUNT_RETRIEVE_FAILED') {
    return hasExactKeys(value, ['kind', 'ok'])
  }
  const accountContract = value.account_contract
  if (value.kind !== 'ACCOUNT_CONTRACT_MISMATCH' ||
    !hasExactKeys(value, ['account_contract', 'kind', 'ok']) ||
    !isRecord(accountContract) ||
    !hasExactKeys(accountContract, accountContractPredicateKeys)) return false
  return accountContractPredicateKeys.every((key) => typeof accountContract[key] === 'boolean')
}

function hasUnsafeProofData(value: unknown): boolean {
  if (typeof value === 'string') return unsafeValuePattern.test(value) || providerIdPattern.test(value)
  if (Array.isArray(value)) return value.some(hasUnsafeProofData)
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value).some(([key, nested]) => unsafeKeyPattern.test(key) || hasUnsafeProofData(nested))
}

export function createManagedStripeProofClient(
  env: StripeIntegrationTestEnv,
  fetcher: typeof fetch = fetch,
): ManagedStripeProofClient {
  return {
    async invoke<T>(action: string, input: Record<string, unknown> = {}): Promise<T> {
      if (!(managedStripeProofActions as readonly string[]).includes(action)) {
        throw new Error(`Unsupported managed proof action: ${action}`)
      }
      const response = await fetcher(env.functionUrl, {
        method: 'POST',
        headers: {
          apikey: env.supabasePublishableKey,
          authorization: `Bearer ${env.supabasePublishableKey}`,
          'content-type': 'application/json',
          'x-task17-proof-token': env.driverToken,
        },
        body: JSON.stringify({ action, ...input }),
      })
      const value: unknown = await response.json()
      if (hasUnsafeProofData(value)) {
        throw new Error('Managed Stripe proof returned unsafe data')
      }
      if (action === 'account_diagnostic' && !isFixedAccountDiagnostic(value)) {
        throw new Error('Managed Stripe diagnostic returned invalid shape')
      }
      if (!response.ok) {
        throw new Error(`Managed Stripe proof action failed: ${action} (${response.status})`)
      }
      return value as T
    },
  }
}
