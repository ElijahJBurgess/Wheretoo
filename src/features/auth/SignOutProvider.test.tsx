import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { signOutAuth } = vi.hoisted(() => ({ signOutAuth: vi.fn() }))
vi.mock('./auth.api', () => ({ signOut: signOutAuth }))
import { captureIdentityLifetime, setAuthenticatedIdentity } from './identityLifetime'
import { registerSessionReconciler } from './sessionReconciliation'
import { SignOutProvider, useSignOut } from './SignOutProvider'
const expectedSession = { user: { id: 'a' }, access_token: 'synthetic-a', refresh_token: 'synthetic-refresh-a' }
const succeeded = { localSignedOut: true, remoteRevoked: true, sessionChanged: false }
function setup() {
  const client = new QueryClient()
  registerSessionReconciler(client, async () => {
    if (!captureIdentityLifetime(client, 'a')()) return null
    setAuthenticatedIdentity(client, null)
    return captureIdentityLifetime(client, null)
  })
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}><SignOutProvider>{children}</SignOutProvider></QueryClientProvider>
  return { client, ...renderHook(() => [useSignOut(), useSignOut()] as const, { wrapper }) }
}
describe('shared sign out', () => {
  beforeEach(() => { vi.resetAllMocks(); signOutAuth.mockResolvedValue(succeeded) })
  it('latches synchronously across two controls and clears owner caches without guest access', async () => {
    let finish!: (result: typeof succeeded) => void
    signOutAuth.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const { client, result } = setup()
    client.setQueryData(['account', 'a'], 'private')
    client.setQueryData(['ticket-collection', 'guest'], 'guest access')
    let first!: Promise<unknown>
    act(() => {
      first = result.current[0].signOut(expectedSession)
      void result.current[1].signOut(expectedSession)
    })
    await waitFor(() => expect(signOutAuth).toHaveBeenCalledOnce())
    expect(result.current[0].pending).toBe(true)
    expect(client.getQueryData(['account', 'a'])).toBeUndefined()
    await act(async () => { finish(succeeded); await first })
    expect(result.current[0].pending).toBe(false)
    expect(client.getQueryData(['ticket-collection', 'guest'])).toBe('guest access')
  })
  it('reports local removal separately from remote failure without disclosing payloads', async () => {
    signOutAuth.mockResolvedValue({ ...succeeded, remoteRevoked: false })
    const { result } = setup()
    let outcome!: unknown
    await act(async () => { outcome = await result.current[0].signOut(expectedSession) })
    expect(outcome).toEqual({ localSignedOut: true, remoteRevoked: false, isCurrent: expect.any(Function) })
    expect(result.current[0].notice).toMatch(/other sessions/i)
    expect(result.current[0].error).toBeNull()
    expect(result.current[0].notice).not.toContain('private provider payload')
  })
  it('does not claim local logout when session remains or cannot be read', async () => {
    signOutAuth.mockRejectedValue(new Error('private provider payload'))
    const { result } = setup()
    await act(async () => { expect(await result.current[0].signOut(expectedSession)).toEqual({ localSignedOut: false, remoteRevoked: false, isCurrent: expect.any(Function) }) })
    expect(result.current[0].error).toMatch(/could not sign out/i)
    expect(result.current[0].notice).toBeNull()
  })
})

it('does not evict B caches or offer an A navigation after a late logout result', async () => {
  vi.clearAllMocks()
  let finish!: (value: typeof succeeded) => void
  signOutAuth.mockReturnValue(new Promise(resolve => { finish = resolve }))
  const { client, result } = setup()
  setAuthenticatedIdentity(client, 'a')
  let operation!: Promise<unknown>
  act(() => { operation = result.current[0].signOut(expectedSession) })
  await waitFor(() => expect(signOutAuth).toHaveBeenCalled())
  setAuthenticatedIdentity(client, 'b')
  client.setQueryData(['account', 'b'], 'B account')
  let outcome!: { isCurrent: () => boolean }
  await act(async () => { finish(succeeded); outcome = await operation as typeof outcome })
  expect(client.getQueryData(['account', 'b'])).toBe('B account')
  expect(result.current[0].notice).toBeNull()
  expect(outcome.isCurrent()).toBe(false)
})
it('revokes a completed logout navigation permission after A to B to A', async () => {
  signOutAuth.mockResolvedValue(succeeded)
  signOutAuth.mockResolvedValue(succeeded)
  const { client, result } = setup()
  let outcome!: { localSignedOut: boolean; isCurrent: () => boolean }
  await act(async () => { outcome = await result.current[0].signOut(expectedSession) as typeof outcome })
  expect(outcome.localSignedOut).toBe(true)
  setAuthenticatedIdentity(client, 'b')
  setAuthenticatedIdentity(client, 'a')
  expect(outcome.isCurrent()).toBe(false)
})

it('explains a refused stale-session logout without claiming any sign-out', async () => {
  signOutAuth.mockResolvedValue({ localSignedOut: false, remoteRevoked: false, sessionChanged: true })
  const { result } = setup()
  await act(async () => { const outcome = await result.current[0].signOut(expectedSession); expect(outcome.localSignedOut).toBe(false); expect(outcome.isCurrent()).toBe(false) })
  expect(result.current[0].error).toMatch(/session changed.*Nothing was signed out/i)
  expect(result.current[0].notice).toBeNull()
})


it('waits for authoritative main-client anonymous reconciliation before success', async () => {
  signOutAuth.mockResolvedValue(succeeded)
  const {client,result}=setup()
  setAuthenticatedIdentity(client,'a')
  let finish!:()=>void
  registerSessionReconciler(client,()=>new Promise(resolve=>{finish=()=>{setAuthenticatedIdentity(client,null);resolve(captureIdentityLifetime(client,null))}}))
  let completed=false
  let task!:ReturnType<typeof result.current[0]['signOut']>
  act(()=>{task=result.current[0].signOut(expectedSession);void task.then(()=>{completed=true})})
  await waitFor(()=>expect(finish).toBeTypeOf('function'))
  expect(completed).toBe(false)
  expect(result.current[0].notice).toBeNull()
  await act(async()=>{finish();await task})
  expect((await task).isCurrent()).toBe(true)
  expect(result.current[0].notice).toBe('You have signed out.')
})
it('rejects a replacement A to B to anonymous while main-client completion waits', async () => {
  signOutAuth.mockResolvedValue(succeeded)
  const {client,result}=setup()
  setAuthenticatedIdentity(client,'a')
  let finish!:()=>void
  registerSessionReconciler(client,()=>new Promise(resolve=>{finish=()=>{setAuthenticatedIdentity(client,null);resolve(captureIdentityLifetime(client,null))}}))
  let task!:ReturnType<typeof result.current[0]['signOut']>
  act(()=>{task=result.current[0].signOut(expectedSession)})
  await waitFor(()=>expect(finish).toBeTypeOf('function'))
  setAuthenticatedIdentity(client,'b')
  await act(async()=>{finish();await task})
  expect((await task).isCurrent()).toBe(false)
  expect(result.current[0].notice).toBeNull()
})
