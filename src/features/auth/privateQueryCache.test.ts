import { QueryClient } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { evictPrivateIdentityQueries } from './privateQueryCache'
it('evicts organizer operations PII while preserving public queries on identity changes', () => {
  const client = new QueryClient()
  client.setQueryData(['organizer-operations', 'owner-a', 'event-a', 'orders'], { buyerEmail: 'guest@example.invalid' })
  client.setQueryData(['tickets', 'public', 'event-a'], 'public event')
  evictPrivateIdentityQueries(client)
  expect(client.getQueryData(['organizer-operations', 'owner-a', 'event-a', 'orders'])).toBeUndefined()
  expect(client.getQueryData(['tickets', 'public', 'event-a'])).toBe('public event')
})
