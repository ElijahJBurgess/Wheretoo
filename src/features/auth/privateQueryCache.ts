import type { Query, QueryClient } from '@tanstack/react-query'
import { invalidateIdentityLifetime } from './identityLifetime'

function isPrivateIdentityQuery(query: Query): boolean {
  const [scope, family] = query.queryKey
  return (scope === 'events' && (family === 'owned' || family === 'detail')) ||
    scope === 'event-change-context' ||
    scope === 'event-notice-status' ||
    scope === 'event-cancellation-summary' ||
    scope === 'account' ||
    scope === 'organizer-settings' ||
    scope === 'organizer' ||
    scope === 'organizer-operations' ||
    (scope === 'tickets' && family === 'owned') ||
    (scope === 'payments' && family === 'connect') ||
    (scope === 'moderation' && (
      family === 'requirements' ||
      family === 'agreement' ||
      family === 'review' ||
      family === 'staff-role' ||
      family === 'queue' ||
      family === 'case'
    ))
}

export function evictPrivateIdentityQueries(queryClient: QueryClient): void {
  invalidateIdentityLifetime(queryClient)
  queryClient.removeQueries({ predicate: isPrivateIdentityQuery })
  const mutations = queryClient.getMutationCache()
  for (const mutation of mutations.getAll()) {
    if (['events', 'organizer-operations', 'organizer', 'organizer-settings', 'account', 'payments'].includes(String(mutation.options.mutationKey?.[0]))) mutations.remove(mutation)
  }
}
