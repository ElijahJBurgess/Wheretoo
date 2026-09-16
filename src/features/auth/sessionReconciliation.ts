import type { QueryClient } from '@tanstack/react-query'

// The mounted SessionProvider owns the authoritative SDK read and identity adoption.
const reconcilers = new WeakMap<QueryClient, () => Promise<(() => boolean) | null>>()
export function registerSessionReconciler(client: QueryClient, reconcile: () => Promise<(() => boolean) | null>) {
  reconcilers.set(client, reconcile)
  return () => { if (reconcilers.get(client) === reconcile) reconcilers.delete(client) }
}
export async function reconcileAnonymousSession(client: QueryClient): Promise<(() => boolean) | null> {
  return await reconcilers.get(client)?.() ?? null
}
