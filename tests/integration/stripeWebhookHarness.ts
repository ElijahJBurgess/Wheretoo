import type { StripeIntegrationTestEnv } from './testEnv'

export const managedStripeProofActions = [
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
const unsafeKeyPattern = /^(?:checkout_?url|confirmation_?bearer|authorization|service_?token|auth_?token|secret|buyer_?(?:email|name)|guest_?(?:email|name)|email)$/i

function hasUnsafeProofData(value: unknown): boolean {
  if (typeof value === 'string') return unsafeValuePattern.test(value)
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
      if (!response.ok) {
        throw new Error(`Managed Stripe proof action failed: ${action} (${response.status})`)
      }
      return value as T
    },
  }
}
