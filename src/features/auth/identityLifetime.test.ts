import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { captureIdentityLifetime, setAuthenticatedIdentity } from './identityLifetime'
import { evictPrivateIdentityQueries } from './privateQueryCache'

describe('authenticated operation lifetime', () => {
  it('rejects an A response after A to B to A even though the id matches again', () => {
    const client = new QueryClient()
    setAuthenticatedIdentity(client, 'a')
    const current = captureIdentityLifetime(client, 'a')
    setAuthenticatedIdentity(client, 'b')
    setAuthenticatedIdentity(client, 'a')
    expect(current()).toBe(false)
    expect(captureIdentityLifetime(client, 'a')()).toBe(true)
    expect(captureIdentityLifetime(client, 'b')()).toBe(false)
  })
  it('invalidates pending work on explicit private eviction while preserving guest link caches', () => {
    const client = new QueryClient()
    const current = captureIdentityLifetime(client, 'a')
    client.setQueryData(['account', 'a'], { name: 'Private name' })
    client.setQueryData(['ticket-collection', 'guest'], 'ticket access')
    client.setQueryData(['refund-detail', 'guest'], 'refund access')
    for (const key of [['organizer', 'save'], ['payments', 'session'], ['account', 'update']]) {
      client.getMutationCache().build(client, { mutationKey: key })
    }
    client.getMutationCache().build(client, { mutationKey: ['guest', 'claim'] })
    evictPrivateIdentityQueries(client)
    expect(current()).toBe(false)
    expect(client.getQueryData(['account', 'a'])).toBeUndefined()
    expect(client.getQueryData(['ticket-collection', 'guest'])).toBe('ticket access')
    expect(client.getQueryData(['refund-detail', 'guest'])).toBe('refund access')
    expect(client.getMutationCache().getAll().map(m => m.options.mutationKey)).toEqual([['guest', 'claim']])
  })
})
