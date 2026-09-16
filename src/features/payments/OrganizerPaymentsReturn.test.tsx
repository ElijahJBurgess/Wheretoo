import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { getOwnedEvent, getConnectStatus, createConnectAccountSession, useSession, useOptionalSignOut, saveEventDraft, publishEvent, saveTicketTiers } = vi.hoisted(() => ({ getOwnedEvent:vi.fn(), getConnectStatus:vi.fn(), createConnectAccountSession:vi.fn(), useSession:vi.fn(), useOptionalSignOut:vi.fn(), saveEventDraft:vi.fn(), publishEvent:vi.fn(), saveTicketTiers:vi.fn() }))
vi.mock('../auth/SessionProvider', () => ({ useSession }))
vi.mock('../auth/SignOutProvider', () => ({ useOptionalSignOut }))
vi.mock('../events/event.api', () => ({ getOwnedEvent, saveEventDraft, publishEvent }))
vi.mock('../tickets/ticket.api', () => ({ saveTicketTiers }))
vi.mock('../../lib/supabase/client', () => ({ supabase: {} }))
vi.mock('./payment.api', () => ({ getConnectStatus, createConnectAccountSession, getExpressLoginUrl:vi.fn() }))
vi.mock('./ConnectEmbeddedPanel', () => ({ ConnectEmbeddedPanel:({onExit}:{onExit:()=>void}) => <button onClick={onExit}>Exit setup</button> }))
import { OrganizerPaymentsPage } from './OrganizerPaymentsPage'
import { paymentKeys } from './payment.queries'
const id='f8f5cd44-5f77-4b6d-8229-ab054f884951'
const otherId='0db7eb3c-c51b-4ac2-af8c-90f1ca64b05e'
const owner='organizer-1'
const ready={status:'ready',last_synced_at:'2026-09-10T12:00:00Z',requirements_currently_due_count:0,requirements_past_due_count:0,last_status_code:null}
function renderPage(eventId=id, cached=false) {
  const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30_000},mutations:{retry:false}}})
  if(cached) client.setQueryData(paymentKeys.connect(owner),ready)
  const router=createMemoryRouter([
    {path:'/organizer/settings/payments',element:<OrganizerPaymentsPage />},
    {path:'/organizer/events/:eventId/preview',element:<h1>Same event preview</h1>},
  ],{initialEntries:[`/organizer/settings/payments?eventId=${eventId}`]})
  return {router,client,...render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)}
}
describe('event-specific Stripe handoff',()=>{
  beforeEach(()=>{
    vi.resetAllMocks()
    useSession.mockReturnValue({status:'authenticated',user:{id:owner}})
    useOptionalSignOut.mockReturnValue(null)
    getOwnedEvent.mockResolvedValue({id,organizer_id:owner,status:'draft'})
    getConnectStatus.mockResolvedValue({status:'not_started'})
    createConnectAccountSession.mockResolvedValue({clientSecret:'test-only',status:{status:'not_started'}})
  })
  it('preserves the saved draft on Do this later and returns to that event without writes',async()=>{
    const user=userEvent.setup();renderPage()
    await user.click(await screen.findByRole('button',{name:'Do this later'}))
    expect(await screen.findByRole('heading',{name:'Same event preview'})).toBeInTheDocument()
    expect(getOwnedEvent).toHaveBeenCalledWith(id,owner)
    expect(getOwnedEvent).toHaveBeenCalledTimes(2)
    expect(getConnectStatus).toHaveBeenCalledTimes(2)
    expect(createConnectAccountSession).not.toHaveBeenCalled()
    expect(saveEventDraft).not.toHaveBeenCalled();expect(publishEvent).not.toHaveBeenCalled();expect(saveTicketTiers).not.toHaveBeenCalled()
  })
  it.each(['bad-id','https://other.example'])('rejects invalid event return %s before requesting data',async(eventId)=>{
    renderPage(eventId)
    expect(await screen.findByText('Event unavailable')).toBeInTheDocument()
    expect(getOwnedEvent).not.toHaveBeenCalled();expect(getConnectStatus).not.toHaveBeenCalled()
  })
  it('rejects an event belonging to another organizer',async()=>{
    getOwnedEvent.mockResolvedValue({id,organizer_id:'other',status:'draft'});renderPage()
    expect(await screen.findByText('Event unavailable')).toBeInTheDocument()
    expect(getConnectStatus).not.toHaveBeenCalled()
  })
  it('rejects a cancelled event before loading Stripe status',async()=>{
    getOwnedEvent.mockResolvedValue({id,organizer_id:owner,status:'cancelled'});renderPage()
    expect(await screen.findByText('Event unavailable')).toBeInTheDocument()
    expect(getConnectStatus).not.toHaveBeenCalled()
  })
  it('does not start an event or Stripe read while sign-out is in flight',()=>{
    useOptionalSignOut.mockReturnValue({pending:true})
    renderPage()
    expect(screen.getByText('Loading payment setup')).toBeInTheDocument()
    expect(getOwnedEvent).not.toHaveBeenCalled();expect(getConnectStatus).not.toHaveBeenCalled()
  })
  it('refreshes cached Connect readiness on arrival',async()=>{
    renderPage(id,true)
    expect(await screen.findByRole('heading',{name:'Secure payouts with Stripe'})).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Return to event'})).not.toBeInTheDocument()
    expect(getConnectStatus).toHaveBeenCalledOnce()
  })
  it('rechecks Connect on embedded exit and returns to the same event without automatic publication',async()=>{
    const user=userEvent.setup();renderPage()
    await user.click(await screen.findByRole('button',{name:'Set up payouts'}))
    await user.click(screen.getByRole('button',{name:'Continue with Stripe'}))
    getConnectStatus.mockResolvedValue(ready)
    await user.click(await screen.findByRole('button',{name:'Exit setup'}))
    expect(await screen.findByRole('button',{name:'Return to event'})).toBeInTheDocument()
    expect(screen.queryByText('Same event preview')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button',{name:'Return to event'}))
    expect(await screen.findByText('Same event preview')).toBeInTheDocument()
    expect(getConnectStatus).toHaveBeenCalledTimes(3)
  })
  it('keeps the event return in place if status refresh fails',async()=>{
    const user=userEvent.setup();getConnectStatus.mockResolvedValue(ready);renderPage()
    await screen.findByRole('button',{name:'Return to event'})
    getConnectStatus.mockRejectedValue(new Error('offline'))
    await user.click(screen.getByRole('button',{name:'Return to event'}))
    expect(await screen.findByRole('heading',{name:'Something went wrong'})).toBeInTheDocument()
    expect(screen.queryByText('Same event preview')).not.toBeInTheDocument()
  })
  it('does not resume a no-longer-owned event after setup',async()=>{
    const user=userEvent.setup();getConnectStatus.mockResolvedValue(ready);renderPage()
    await screen.findByRole('button',{name:'Return to event'})
    getOwnedEvent.mockResolvedValue(null)
    await user.click(screen.getByRole('button',{name:'Return to event'}))
    await waitFor(()=>expect(screen.getByRole('heading',{name:'Something went wrong'})).toBeInTheDocument())
    expect(screen.queryByText('Same event preview')).not.toBeInTheDocument()
  })
  it('drops an in-flight same-owner return after switching to another event',async()=>{
    const user=userEvent.setup()
    let resolveStatus!:(value:typeof ready)=>void
    getConnectStatus.mockResolvedValueOnce(ready).mockReturnValueOnce(new Promise(resolve=>{resolveStatus=resolve}))
    getOwnedEvent.mockImplementation(async(eventId:string)=>({id:eventId,organizer_id:owner,status:'draft'}))
    const {router}=renderPage()
    await screen.findByRole('button',{name:'Return to event'})
    await user.click(screen.getByRole('button',{name:'Return to event'}))
    await router.navigate(`/organizer/settings/payments?eventId=${otherId}`)
    await waitFor(()=>expect(getOwnedEvent).toHaveBeenCalledWith(otherId,owner))
    resolveStatus(ready)
    await waitFor(()=>expect(router.state.location.pathname).toBe('/organizer/settings/payments'))
    expect(router.state.location.search).toBe(`?eventId=${otherId}`)
    expect(getOwnedEvent).not.toHaveBeenCalledTimes(3)
  })
})
