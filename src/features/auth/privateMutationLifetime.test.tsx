import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
const { saveOrganizer, createConnectAccountSession } = vi.hoisted(() => ({ saveOrganizer: vi.fn(), createConnectAccountSession: vi.fn() }))
vi.mock('../organizers/organizer.api', () => ({ saveOrganizer, getOrganizer: vi.fn() }))
vi.mock('../payments/payment.api', () => ({ createConnectAccountSession, getConnectStatus: vi.fn() }))
import { useSaveOrganizer, organizerKeys } from '../organizers/organizer.queries'
import { useConnectAccountSession, paymentKeys } from '../payments/payment.queries'
import { setAuthenticatedIdentity } from './identityLifetime'
import { evictPrivateIdentityQueries } from './privateQueryCache'
const wrapper = (client: QueryClient) => ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
describe('private mutation completions', () => {
  it('a removed organizer save cannot repopulate the A cache after A to B to A', async () => {
    let finish!: (value: unknown) => void
    saveOrganizer.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const client = new QueryClient()
    setAuthenticatedIdentity(client, 'a')
    const { result } = renderHook(() => useSaveOrganizer('a'), { wrapper: wrapper(client) })
    let pending!: Promise<unknown>
    act(() => { pending = result.current.mutateAsync({ displayName: 'Name', bio: '' }) })
    await vi.waitFor(() => expect(saveOrganizer).toHaveBeenCalled())
    setAuthenticatedIdentity(client, 'b'); evictPrivateIdentityQueries(client); setAuthenticatedIdentity(client, 'a')
    await act(async () => { finish({ display_name: 'Late name' }); await pending })
    expect(client.getQueryData(organizerKeys.detail('a'))).toBeUndefined()
    expect(client.getMutationCache().getAll()).toHaveLength(0)
  })
  it('a Connect session cannot return secrets or repopulate caches after sign-out', async () => {
    let finish!: (value: unknown) => void
    createConnectAccountSession.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const client = new QueryClient()
    setAuthenticatedIdentity(client, 'a')
    const { result } = renderHook(() => useConnectAccountSession(), { wrapper: wrapper(client) })
    let pending!: Promise<unknown>
    act(() => { pending = result.current.mutateAsync('a') })
    await vi.waitFor(() => expect(createConnectAccountSession).toHaveBeenCalled())
    evictPrivateIdentityQueries(client); setAuthenticatedIdentity(client, null)
    const outcome = pending.catch(error => error)
    await act(async () => { finish({ clientSecret: crypto.randomUUID(), status: { status: 'ready' } }); await outcome })
    expect(await outcome).toBeInstanceOf(Error)
    expect(client.getQueryData(paymentKeys.connect('a'))).toBeUndefined()
    expect(client.getMutationCache().getAll()).toHaveLength(0)
  })
  it('returns an active Connect session only to caller memory, never the mutation cache', async () => {
    const client = new QueryClient()
    const secret = crypto.randomUUID()
    createConnectAccountSession.mockResolvedValue({ clientSecret: secret, status: { status: 'ready' } })
    const { result } = renderHook(() => useConnectAccountSession(), { wrapper: wrapper(client) })
    let session!: unknown
    await act(async () => { session = await result.current.mutateAsync('a') })
    expect(session).toMatchObject({ clientSecret: secret })
    expect(client.getMutationCache().getAll()).toHaveLength(0)
    expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.state.data))).not.toContain(secret)
  })
})
