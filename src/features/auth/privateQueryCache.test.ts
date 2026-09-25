import { QueryClient } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { evictPrivateIdentityQueries } from './privateQueryCache'
it('clears private import queries and uncertain-upload receipts when identity changes', () => {
  const client = new QueryClient()
  client.setQueryData(['event-imports', 'owner-a', 'batch'], { private: true })
  const receiptKey = 'event-import-upload:owner-a:digest:private.csv'
  sessionStorage.setItem(receiptKey, 'request-id')
  sessionStorage.setItem('unrelated-preference', 'keep')
  evictPrivateIdentityQueries(client)
  expect(client.getQueryData(['event-imports', 'owner-a', 'batch'])).toBeUndefined()
  expect(sessionStorage.getItem(receiptKey)).toBeNull()
  expect(sessionStorage.getItem('unrelated-preference')).toBe('keep')
  sessionStorage.removeItem('unrelated-preference')
})
it('evicts organizer operations PII while preserving public queries on identity changes', () => {
  const client = new QueryClient()
  client.setQueryData(['organizer-operations', 'owner-a', 'event-a', 'orders'], {
    buyerEmail: 'guest@example.invalid',
  })
  client.setQueryData(['tickets', 'public', 'event-a'], 'public event')
  evictPrivateIdentityQueries(client)
  expect(client.getQueryData(['organizer-operations', 'owner-a', 'event-a', 'orders']))
    .toBeUndefined()
  expect(client.getQueryData(['tickets', 'public', 'event-a'])).toBe('public event')
})
it('removes pending operational mutations even when they settle after sign-out', async () => {
  const client = new QueryClient()
  let resolve!: (value: { buyerName: string }) => void
  const pending = new Promise<{ buyerName: string }>((done) => {
    resolve = done
  })
  const mutation = client.getMutationCache().build(client, {
    mutationKey: ['organizer-operations', 'owner', 'event', 'admit'],
    mutationFn: () => pending,
  })
  const work = mutation.execute(undefined)
  evictPrivateIdentityQueries(client)
  expect(client.getMutationCache().getAll()).toHaveLength(0)
  resolve({ buyerName: 'Private buyer' })
  await work
  expect(client.getMutationCache().getAll()).toHaveLength(0)
})
it('evicts event change history, notice recipients and cancellation aggregates on identity changes', () => {
  const client = new QueryClient()
  const scopes = ['event-images', 'event-change-context', 'event-notice-status', 'event-cancellation-summary']
  for (const scope of scopes) client.setQueryData([scope, 'owner-a', 'event-a'], { private: true })
  evictPrivateIdentityQueries(client)
  for (const scope of scopes) expect(client.getQueryData([scope, 'owner-a', 'event-a'])).toBeUndefined()
})
