import {beforeEach,expect,it} from 'vitest'
import {captureWaitlistLeave,clearWaitlistLeave,readWaitlistLeave,joinRequestKey} from './waitlist.session'
beforeEach(()=>{clearWaitlistLeave();sessionStorage.clear();history.replaceState(null,'','/')})
it('captures a namespaced bearer then removes it from location without network mutation',()=>{
 const token='wl1_'+'A'.repeat(43);history.replaceState(null,'','/waitlist/leave#'+token);captureWaitlistLeave();expect(location.hash).toBe('');expect(readWaitlistLeave()).toBe(token);clearWaitlistLeave();expect(readWaitlistLeave()).toBeNull()
})
it('invalid fragment clears prior authorization and is scrubbed',()=>{
 history.replaceState(null,'','/waitlist/leave#not-a-token');captureWaitlistLeave();expect(location.hash).toBe('');expect(readWaitlistLeave()).toBeNull()
})
it('request storage key contains no plaintext PII',async()=>{
 const key=await joinRequestKey({eventId:'event',tierId:'tier',name:'Buyer Name',email:'buyer@example.invalid'});expect(key).toMatch(/^wheretoo:waitlist-request:[a-f0-9]{64}$/)
})
