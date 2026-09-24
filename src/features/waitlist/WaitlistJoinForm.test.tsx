import { fireEvent,render,screen,waitFor } from '@testing-library/react'
import { beforeEach,expect,it,vi } from 'vitest'
import { WaitlistJoinForm } from './WaitlistJoinForm'
const join=vi.hoisted(()=>vi.fn())
vi.mock('./waitlist.api',()=>({joinWaitlist:join}))
beforeEach(()=>{vi.resetAllMocks();sessionStorage.clear()})
it('joins with only identity fields and gives generic success',async()=>{
 join.mockResolvedValue({kind:'joined'})
 render(<WaitlistJoinForm eventId='event' tierId='tier' tierName='GA' onAvailable={vi.fn()} onCancel={vi.fn()}/>)
 fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Buyer'}});fireEvent.change(screen.getByLabelText('Email'),{target:{value:'buyer@example.invalid'}})
 fireEvent.click(screen.getByRole('button',{name:'Join Waitlist'}))
 expect(await screen.findByRole('status')).toHaveTextContent('GA tickets become available')
 expect(Object.keys(join.mock.calls[0][0]).sort()).toEqual(['email','eventId','name','requestId','tierId'])
})
it('reopened inventory invokes refresh without success or checkout',async()=>{
 join.mockResolvedValue({kind:'TICKETS_AVAILABLE'});const available=vi.fn()
 render(<WaitlistJoinForm eventId='event' tierId='tier' tierName='GA' onAvailable={available} onCancel={vi.fn()}/>)
 fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Buyer'}});fireEvent.change(screen.getByLabelText('Email'),{target:{value:'buyer@example.invalid'}})
 fireEvent.click(screen.getByRole('button',{name:'Join Waitlist'}));await waitFor(()=>expect(available).toHaveBeenCalledOnce())
 expect(screen.queryByText(/You’re on the waitlist/)).not.toBeInTheDocument()
})
it('unknown outcome retries the same durable request without changing identity',async()=>{
 join.mockRejectedValueOnce(Error('lost response')).mockResolvedValueOnce({kind:'joined'})
 render(<WaitlistJoinForm eventId='event' tierId='tier' tierName='GA' onAvailable={vi.fn()} onCancel={vi.fn()}/>)
 fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Buyer'}});fireEvent.change(screen.getByLabelText('Email'),{target:{value:'buyer@example.invalid'}})
 fireEvent.click(screen.getByRole('button',{name:'Join Waitlist'}));expect(await screen.findByRole('alert')).toHaveTextContent('could not confirm')
 expect(screen.getByLabelText('Name')).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Try again'}));expect(await screen.findByRole('status')).toHaveTextContent('You’re on the waitlist')
 expect(join.mock.calls[0][0]).toEqual(join.mock.calls[1][0])
})
