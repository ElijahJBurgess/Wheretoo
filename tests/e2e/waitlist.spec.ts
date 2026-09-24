import {test,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {connect,f,sql,shot} from './support/waitlist'
test.afterEach(async({page})=>{await page.unrouteAll({behavior:'wait'})})
const buyerEmail=`browser-${Date.now()}@example.invalid`
const eventPath=`/events/${f.event}/tickets`
function soldOut(){sql(`update public.ticket_tiers set quantity_total=(select protected_quantity from private.ticket_tier_inventory('${f.tier}',clock_timestamp())) where id='${f.tier}';select public.server_acknowledge_waitlist_worker();`)}
test('mobile mixed tiers, identity-only join and duplicate generic success',async({page})=>{
 soldOut();await connect(page);await page.goto(eventPath)
 await expect(page.getByRole('button',{name:'Join Waitlist',exact:true})).toHaveCount(1)
 await expect(page.getByLabel('VIP quantity')).toBeEnabled()
 await page.getByLabel('VIP quantity').fill('1')
 await page.getByRole('button',{name:'Join Waitlist',exact:true}).click()
 await expect(page.getByLabel('Name',{exact:true})).toBeFocused()
 await page.getByLabel('Name',{exact:true}).fill('Browser Buyer');await page.getByLabel('Email',{exact:true}).fill(buyerEmail)
 const layout=await page.locator('.public-ticket-tier:has(.waitlist-form)').evaluate(card=>{const copy=card.querySelector('.public-ticket-tier__copy')!.getBoundingClientRect(),form=card.querySelector('.waitlist-form')!.getBoundingClientRect();return {copyWidth:copy.width,formTop:form.top,copyBottom:copy.bottom}});expect(layout.copyWidth).toBeGreaterThan(140);expect(layout.formTop).toBeGreaterThanOrEqual(layout.copyBottom)
 await shot(page,'buyer-mobile-form')
 await page.getByRole('button',{name:'Join Waitlist',exact:true}).click()
 await expect(page.getByText('You’re on the waitlist.',{exact:false})).toBeVisible()
 await expect(page.getByLabel('VIP quantity')).toHaveValue('1')
 await page.reload();await page.getByRole('button',{name:'Join Waitlist',exact:true}).click()
 await page.getByLabel('Name',{exact:true}).fill('Different name');await page.getByLabel('Email',{exact:true}).fill(buyerEmail.toUpperCase())
 await page.getByRole('button',{name:'Join Waitlist',exact:true}).click();await expect(page.getByText('You’re on the waitlist.',{exact:false})).toBeVisible()
 expect(sql(`select count(*) from private.waitlist_enrollments where tier_id='${f.tier}' and normalized_email='${buyerEmail}';`)).toBe('1')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('desktop reopening refreshes and focuses normal quantity without selecting it',async({page})=>{
 soldOut();await page.setViewportSize({width:1440,height:1000});await connect(page);await page.goto(eventPath)
 await page.getByRole('button',{name:'Join Waitlist',exact:true}).click()
 await page.getByLabel('Name',{exact:true}).fill('Reopen Buyer');await page.getByLabel('Email',{exact:true}).fill(`reopen-${Date.now()}@example.invalid`)
 sql(`update public.ticket_tiers set quantity_total=100000 where id='${f.tier}';`)
 await page.getByRole('button',{name:'Join Waitlist',exact:true}).click()
 await expect(page.getByText('Ticket availability refreshed.',{exact:false})).toBeVisible()
 await expect(page.getByLabel('General Admission quantity',{exact:true})).toBeFocused();await expect(page.getByLabel('General Admission quantity',{exact:true})).toHaveValue('0')
 await shot(page,'buyer-desktop-reopened')
})
test('owner paginates and confirms removal; foreign owner denied',async({page})=>{
 await connect(page,'owner');await page.goto(`/organizer/events/${f.event}/dashboard`);await page.getByRole('link',{name:'Waitlist',exact:true}).click();await expect(page).toHaveURL(new RegExp(`/organizer/events/${f.event}/waitlist$`))
 await page.getByRole('button',{name:/^General Admission /}).click();await expect(page.locator('tbody tr')).toHaveCount(50)
 const first=await page.locator('tbody tr').first().textContent();await page.getByRole('button',{name:'Older enrollments'}).click();await expect(page.locator('tbody tr')).toHaveCount(50);expect(await page.locator('tbody tr').first().textContent()).not.toBe(first)
 await page.getByRole('button',{name:'Newest',exact:true}).click();await page.getByRole('button',{name:'Remove from waitlist',exact:true}).first().click();await expect(page.getByRole('dialog')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await shot(page,'owner-mobile-confirm');await page.getByRole('button',{name:'Cancel',exact:true}).click()
 await page.getByRole('button',{name:'Remove from waitlist',exact:true}).first().click();await page.getByRole('button',{name:'Remove',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByRole('cell',{name:'Removed',exact:true}).first()).toBeVisible()
 await page.setViewportSize({width:1440,height:1000});await shot(page,'owner-desktop')
})
test('foreign access is denied server-side',async({page})=>{await connect(page,'other');await page.goto(`/organizer/events/${f.event}/waitlist`);await expect(page.getByText('Waitlist unavailable.',{exact:false})).toBeVisible()})
test('leave fragment scrub has no GET mutation and explicit repeat is harmless',async({page})=>{
 const token=readFileSync('.superpowers/waitlist-proof/leave-token.txt','utf8').trim();await connect(page)
 let posts=0;page.on('request',r=>{if(r.url().includes('/waitlist-leave')&&r.method()==='POST')posts++})
 await page.goto('/waitlist/leave#'+token);await expect(page.getByRole('button',{name:'Leave Waitlist',exact:true})).toBeVisible();expect(new URL(page.url()).hash).toBe('');expect(posts).toBe(0)
 await page.getByRole('button',{name:'Leave Waitlist',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByText('You’ve been removed from this waitlist.')).toBeVisible();expect(posts).toBe(1);await shot(page,'leave-mobile-complete')
 await page.goto('/waitlist/leave#wl1_'+ 'A'.repeat(43));await page.getByRole('button',{name:'Leave Waitlist',exact:true}).click();await expect(page.getByText('This waitlist link is unavailable or expired.')).toBeVisible()
})
test('all sold out and single-tier views retain a usable mobile join action',async({page})=>{
 soldOut();sql(`update public.ticket_tiers set quantity_total=1 where id='${f.otherTier}';update public.ticket_tiers set status='archived' where event_id='${f.event}' and id not in ('${f.tier}','${f.otherTier}');`)
 try{await connect(page);await page.goto(eventPath);await expect(page.getByRole('button',{name:'Join Waitlist',exact:true})).toHaveCount(2);await shot(page,'buyer-all-sold-out');sql(`update public.ticket_tiers set status='archived' where id='${f.otherTier}';`);await page.reload();await expect(page.getByRole('button',{name:'Join Waitlist',exact:true})).toHaveCount(1);await page.getByRole('button',{name:'Join Waitlist',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByLabel('Name',{exact:true})).toBeFocused();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('button',{name:'Join Waitlist',exact:true})).toBeFocused()}
 finally{sql(`update public.ticket_tiers set status='active' where event_id='${f.event}';update public.ticket_tiers set quantity_total=8 where id='${f.otherTier}';`)}
})
test('failed refresh after reopening reports uncertainty and preserves the cart',async({page})=>{
 soldOut();await connect(page);await page.goto(eventPath);await page.getByLabel('VIP quantity').fill('1');await page.getByRole('button',{name:'Join Waitlist',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Refresh Buyer');await page.getByLabel('Email',{exact:true}).fill(`refresh-${Date.now()}@example.invalid`)
 sql(`update public.ticket_tiers set quantity_total=100000 where id='${f.tier}';`);await page.route('**/rest/v1/rpc/get_public_event_ticketing',route=>route.abort('failed'));await page.getByRole('button',{name:'Join Waitlist',exact:true}).click();await expect(page.getByText('Could not refresh ticket availability.',{exact:false})).toBeVisible();await expect(page.getByLabel('VIP quantity')).toHaveValue('1');await expect(page.getByRole('button',{name:'Join Waitlist',exact:true})).toHaveCount(0);await shot(page,'buyer-refresh-failed')
})
test('started event hides joins and owner sees closed history',async({page})=>{
 soldOut();const original=sql(`select starts_at from public.events where id='${f.event}';`)
 try{sql(`set session_replication_role=replica;update public.events set starts_at=clock_timestamp()-interval '1 minute' where id='${f.event}';`);await connect(page,'owner');await page.goto(eventPath);await expect(page.getByRole('heading',{name:'Checkout Integrity Fulfillment Event',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Join Waitlist',exact:true})).toHaveCount(0);await page.goto(`/organizer/events/${f.event}/waitlist`);await expect(page.getByText('This waitlist is closed.',{exact:false})).toBeVisible();await shot(page,'owner-closed')}
 finally{sql(`set session_replication_role=replica;update public.events set starts_at='${original}' where id='${f.event}';`)}
})
