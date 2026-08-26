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
      if (!response.ok) {
        throw new Error(`Managed Stripe proof action failed: ${action} (${response.status})`)
      }
      return value as T
    },
  }
}
