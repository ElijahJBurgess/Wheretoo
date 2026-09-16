import type { QueryClient } from '@tanstack/react-query'

type IdentityLifetime = { generation: number; authenticationGeneration: number; userId: string | null | undefined }
const lifetimes = new WeakMap<QueryClient, IdentityLifetime>()
function lifetimeFor(client: QueryClient): IdentityLifetime {
  let lifetime = lifetimes.get(client)
  if (!lifetime) {
    lifetime = { generation: 0, authenticationGeneration: 0, userId: undefined }
    lifetimes.set(client, lifetime)
  }
  return lifetime
}

export function setAuthenticatedIdentity(client: QueryClient, userId: string | null): void {
  const lifetime = lifetimeFor(client)
  if (lifetime.userId !== userId) {
    lifetime.generation += 1
    lifetime.userId = userId
    if (userId !== null) lifetime.authenticationGeneration += 1
  }
}

export function invalidateIdentityLifetime(client: QueryClient): void {
  lifetimeFor(client).generation += 1
}

/** Capture at dispatch, not completion: an A → B → A cycle is a different lifetime. */
export function captureIdentityLifetime(client: QueryClient, userId: string | null): () => boolean {
  const lifetime = lifetimeFor(client)
  const generation = lifetime.generation
  return () => lifetime.generation === generation && (userId === null || userId.length > 0) &&
    (lifetime.userId === undefined || lifetime.userId === userId)
}

/** Also guards anonymous-session completions, such as post-logout navigation. */
export function captureIdentityGeneration(client: QueryClient): () => boolean {
  const lifetime = lifetimeFor(client)
  const generation = lifetime.generation
  return () => lifetime.generation === generation
}

/** Observed non-anonymous transitions fence logout completion before React commits. */
export function observeAuthenticatedIdentity(client: QueryClient): void {
  lifetimeFor(client).authenticationGeneration += 1
}
export function captureSignOutLifetime(client: QueryClient): () => boolean {
  const lifetime = lifetimeFor(client)
  const generation = lifetime.authenticationGeneration
  return () => lifetime.authenticationGeneration === generation
}
