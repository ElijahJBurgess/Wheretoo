import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
const { cancelOwnedEvent, saveEventDraft } = vi.hoisted(() => ({ cancelOwnedEvent: vi.fn(), saveEventDraft: vi.fn() }))
vi.mock('../events/event.api', () => ({ cancelOwnedEvent, getOwnedEvent: vi.fn(), listOwnedEvents: vi.fn(), publishEvent: vi.fn(), saveEventDraft, saveEventRevision: vi.fn() }))
import { useCancelOwnedEvent, useSaveEventDraft, eventKeys } from '../events/event.queries'
import { setAuthenticatedIdentity } from './identityLifetime'
import { evictPrivateIdentityQueries } from './privateQueryCache'
const wrapper = (client: QueryClient) => ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
describe('Spec 10 + 11 identity integration', () => {
  it.each(['sign-out pending', 'A to B to A'])('late canonical cancellation cannot restore private event data after %s', async mode => {
    let finish!: (value: unknown) => void
    cancelOwnedEvent.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const client = new QueryClient()
    setAuthenticatedIdentity(client, 'a')
    const { result } = renderHook(() => useCancelOwnedEvent('a'), { wrapper: wrapper(client) })
    let pending!: Promise<unknown>
    act(() => { pending = result.current.mutateAsync('event') })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    evictPrivateIdentityQueries(client)
    if (mode === 'A to B to A') { setAuthenticatedIdentity(client, 'b'); setAuthenticatedIdentity(client, 'a') }
    const outcome = pending.catch(error => error)
    await act(async () => { finish({ id: 'event', organizer_id: 'a', status: 'cancelled' }); await outcome })
    expect(client.getQueryData(eventKeys.detail('a', 'event'))).toBeUndefined()
    expect(client.getMutationCache().getAll()).toHaveLength(0)
  })
  it('evicts all organizer domains together while preserving guest access', () => {
    const client = new QueryClient()
    const privateKeys = [['event-change-context','a','event'], ['event-notice-status','a','event'], ['event-cancellation-summary','a','event'], ['account','a'], ['organizer-settings','a'], ['payments','connect','a'], ['organizer','a']]
    const guestKeys = [['ticket-collection','guest'], ['refund-details','guest'], ['event-status','guest']]
    for (const key of [...privateKeys,...guestKeys]) client.setQueryData(key,{ retained: true })
    evictPrivateIdentityQueries(client)
    for (const key of privateKeys) expect(client.getQueryData(key)).toBeUndefined()
    for (const key of guestKeys) expect(client.getQueryData(key)).toEqual({ retained: true })
  })
})

it('late new-event save cannot restore private event data after Settings sign-out', async () => {
 let finish!: (value: unknown) => void
 saveEventDraft.mockReturnValue(new Promise(resolve => { finish = resolve }))
 const client = new QueryClient(); setAuthenticatedIdentity(client,'a')
 const { result } = renderHook(() => useSaveEventDraft(),{wrapper:wrapper(client)})
 let pending!: Promise<unknown>
 act(() => { pending = result.current.mutateAsync({eventId:null,organizerId:'a',values:{title:'Draft',description:'',category:'',startsAt:'',endsAt:'',timezone:'America/Los_Angeles',venueName:'',location:null,admissionType:'free',capacity:null}}) })
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'))
 evictPrivateIdentityQueries(client)
 const outcome=pending.catch(error=>error)
 await act(async()=>{ finish({id:'new-event',organizer_id:'a',status:'draft'}); await outcome })
 expect(client.getQueryData(eventKeys.detail('a','new-event'))).toBeUndefined()
 expect(client.getMutationCache().getAll()).toHaveLength(0)
})
