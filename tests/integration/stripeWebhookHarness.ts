import type { StripeIntegrationTestEnv } from './testEnv'

export type ManagedStripeProofClient = {
  invoke<T>(action: string, input?: Record<string, unknown>): Promise<T>
}

export function createManagedStripeProofClient(
  env: StripeIntegrationTestEnv,
  fetcher: typeof fetch = fetch,
): ManagedStripeProofClient {
  return {
    async invoke<T>(action: string, input: Record<string, unknown> = {}): Promise<T> {
      const response = await fetcher(env.functionUrl, {
        method: 'POST',
        headers: {
          apikey: env.supabasePublishableKey,
          authorization: `Bearer ${env.supabasePublishableKey}`,
          'content-type': 'application/json',
          'x-task17-onboarding-token': env.driverToken,
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
