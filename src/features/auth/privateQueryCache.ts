import type { Query, QueryClient } from '@tanstack/react-query'

function isPrivateIdentityQuery(query: Query): boolean {
  const [scope, family] = query.queryKey
  return (scope === 'events' && (family === 'owned' || family === 'detail'))
    || scope === 'organizer'
    || scope === 'organizer-operations'
    || (scope === 'tickets' && family === 'owned')
    || (scope === 'payments' && family === 'connect')
    || (scope === 'moderation' && (
      family === 'requirements'
      || family === 'agreement'
      || family === 'review'
      || family === 'staff-role'
      || family === 'queue'
      || family === 'case'
    ))
}

export function evictPrivateIdentityQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: isPrivateIdentityQuery })
}
