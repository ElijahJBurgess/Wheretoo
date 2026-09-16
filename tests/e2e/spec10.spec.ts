import {test,expect,type Page} from '@playwright/test'
import {createHmac} from 'node:crypto'
import {readFileSync,mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
const edge='http://127.0.0.1:55547',origin='http://127.0.0.1:3030'
execFileSync('python3',['tests/integration/spec10-browser-fixture.py'],{stdio:'pipe'})
const fixture=JSON.parse(readFileSync('.superpowers/spec10/browser-fixture.json','utf8')) as {ownerId:string;eventId:string;orderId:string;paidToken:string;freeOwnerId:string;freeEventId:string;freeToken:string;freeRegistrationId:string}
function sql(statement:string){return execFileSync('python3',['tests/integration/spec10-database.py','sql'],{input:statement,encoding:'utf8'})}
function jwt(owner:string){const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');const body=enc({alg:'HS256',typ:'JWT'})+'.'+enc({role:'authenticated',sub:owner,exp:1893456000});return body+'.'+createHmac('sha256','spec10-local-only-jwt-secret-disposable-2026').update(body).digest('base64url')}
async function connect(page:Page,owner?:string){
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin==='https://spec10-local.supabase.co'){
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}})
   const response=await route.fetch({url:edge+url.pathname+url.search,headers:{...route.request().headers(),origin}});return route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':origin}})
  }
  if(url.hostname!=='127.0.0.1')return route.abort('blockedbyclient');return route.continue()
 })
 if(owner) await page.route('**/functions/v1/stripe-connect-status', route => route.fulfill({json:{status:'ready',requirements_currently_due_count:0,requirements_past_due_count:0,last_status_code:null,last_synced_at:'2026-09-12T00:00:00Z'},headers:{'access-control-allow-origin':origin}}))
 if(owner)await page.addInitScript(({owner,access})=>localStorage.setItem('sb-spec10-local-auth-token',JSON.stringify({access_token:access,refresh_token:'local-only',expires_at:1893456000,expires_in:9999999,token_type:'bearer',user:{id:owner,email:'owner@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}})),{owner,access:jwt(owner)})
}
async function shot(page:Page,name:string){mkdirSync('.superpowers/spec10/browser-visual',{recursive:true});await page.screenshot({path:`.superpowers/spec10/browser-visual/${name}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)}
async function settingsRoundTrip(page: Page, eventId: string, destination: string, heading: string, payments = false) {
 const before = sql(`select jsonb_build_object('event',to_jsonb(e),'orders',(select jsonb_agg(to_jsonb(o) order by id) from public.orders o where event_id=e.id),'tickets',(select jsonb_agg(to_jsonb(t) order by id) from public.tickets t where event_id=e.id),'notices',(select jsonb_agg(to_jsonb(n) order by attempt_id) from private.event_notice_sources n where event_id=e.id)) from public.events e where id='${eventId}';`)
 await page.waitForLoadState('networkidle')
 await page.getByRole('link',{name:'Settings',exact:true}).first().click()
 await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible()
 if(payments) { await page.getByRole('link',{name:/Payments & Payouts/}).click(); await expect(page.getByRole('heading',{name:'Payments & Payouts',exact:true})).toBeVisible() }
 await page.goto(`/organizer/events/${eventId}/${destination}`)
 await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible()
 const after = sql(`select jsonb_build_object('event',to_jsonb(e),'orders',(select jsonb_agg(to_jsonb(o) order by id) from public.orders o where event_id=e.id),'tickets',(select jsonb_agg(to_jsonb(t) order by id) from public.tickets t where event_id=e.id),'notices',(select jsonb_agg(to_jsonb(n) order by attempt_id) from private.event_notice_sources n where event_id=e.id)) from public.events e where id='${eventId}';`)
 expect(after).toBe(before)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
}
async function deliver(page:Page,eventId:string,purpose:'event_change'|'event_cancellation') {
 const result=sql(`select attempt_id from private.event_notice_sources where event_id='${eventId}' and purpose='${purpose}';`)
 const attempt=result.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)![0]
 for(let n=0;n<20;n++) { const messages=await(await page.request.get(edge+'/__spec10/messages')).json() as {attemptId:string;text:string}[];const found=messages.find(m=>m.attemptId===attempt);if(found)return found;await page.request.post(edge+'/__spec10/work',{data:{mode:'accepted'}}) }
 throw new Error('Current fixture notice was not captured')
}
test.afterEach(async({page})=>{await page.unrouteAll({behavior:'wait'});sql('update private.ticket_email_settings set worker_enabled=false;')})
test('Spec10 production owner and buyer routes with canonical local data',async({page,browser})=>{
 await connect(page,fixture.ownerId)
 await page.goto(`/organizer/events/${fixture.eventId}/edit`)
 await expect(page.getByLabel('Event title',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Continue to date & location'}).click()
 await page.getByLabel('Venue name',{exact:true}).fill('Harbor Community Terrace')
 await page.getByRole('button',{name:'Save changes',exact:true}).click()
 await expect(page.getByRole('button',{name:'Save changes',exact:true})).toBeEnabled()
 await page.waitForLoadState('networkidle')
 await page.getByRole('link',{name:'Settings',exact:true}).first().click()
 await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible()
 await page.goto(`/organizer/events/${fixture.eventId}/edit`)
 await page.getByRole('button',{name:'Continue to date & location'}).click()
 await expect(page.getByLabel('Venue name',{exact:true})).toHaveValue('Harbor Community Terrace')
 await page.getByRole('button',{name:'Continue to tickets & admission'}).click()
 await page.getByRole('button',{name:'Continue to event requirements'}).click()
 await page.getByRole('button',{name:'Continue to organizer agreement'}).click()
 await page.getByRole('checkbox',{name:/I confirm that this event information/}).check()
 await page.getByRole('button',{name:'Save agreement and preview'}).click()
 await expect(page).toHaveURL(new RegExp(`/organizer/events/${fixture.eventId}/preview$`))
 await page.getByRole('button',{name:'Publish changes',exact:true}).click()
 await expect(page).not.toHaveURL(new RegExp('/preview$'))
 await page.goto(`/organizer/events/${fixture.eventId}/changes`)
 await expect(page.getByRole('heading',{name:'Previous → New',exact:true})).toBeVisible()
 await expect(page.getByText(/Notice required/).first()).toBeVisible()
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await shot(page,`history-${width}`)}
 await page.getByRole('button',{name:'Review notice recipients'}).click()
 await expect(page.getByRole('heading',{name:'Reviewed audience'})).toBeVisible()
 await page.getByRole('button',{name:'Submit reviewed notice'}).click()
 await expect(page.getByText('1 message queued. This does not confirm sending or delivery.')).toBeVisible()
 sql("update private.ticket_email_outbox set next_attempt_at=now()+interval '1 day' where purpose not in ('event_change','event_cancellation');update private.ticket_email_settings set worker_enabled=true;")
 await settingsRoundTrip(page,fixture.eventId,'changes','Previous → New',true)
 const change=await deliver(page,fixture.eventId,'event_change')
 const updated=await browser.newPage();await connect(updated)
 await updated.goto(`${origin}/event-status#${change.text.match(/#(em1_[A-Za-z0-9_-]{43})/)![1]}`)
 await expect(updated.getByRole('heading',{name:'Event details updated',exact:true})).toBeVisible()
 await expect(updated.getByText('Harbor Community Terrace',{exact:true})).toBeVisible()
 await expect(updated.locator('canvas')).toHaveCount(0)
 await expect(updated.getByRole('link',{name:'View your tickets'})).toBeVisible()
 expect(new URL(updated.url()).hash).toBe('')
 await updated.setViewportSize({width:390,height:900});await shot(updated,'buyer-updated-390')
 await updated.getByRole('link',{name:'View your tickets'}).click()
 await expect(updated.locator('.buyer-wallet-row')).toHaveCount(3)
 await updated.getByRole('link',{name:/, Valid$/}).first().click()
 await expect(updated.getByLabel('Admission QR code')).toHaveAttribute('data-qr-ready','true')
 await updated.unrouteAll({behavior:'wait'}); await updated.close()
 // Lose only the canonical reply after it has committed, then fail the independent summary.
 let lost=false
 await page.route('**/rest/v1/rpc/cancel_owned_event',async route=>{const response=await route.fetch({url:edge+'/rest/v1/rpc/cancel_owned_event',headers:{...route.request().headers(),origin}});expect(response.ok()).toBe(true);lost=true;await route.fulfill({status:503,body:'{}',headers:{'access-control-allow-origin':origin}})})
 await page.route('**/rest/v1/rpc/get_owned_event_cancellation_summary',route=>route.fulfill({status:503,body:'{}',headers:{'access-control-allow-origin':origin}}))
 await page.goto(`/organizer/events/${fixture.eventId}/cancellation`)
 await page.getByRole('button',{name:'Cancel event',exact:true}).click()
 await shot(page,'cancel-confirm-1440')
 await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Event cancelled',exact:true})).toBeVisible();expect(lost).toBe(true)
 await expect(page.getByText('Summary unavailable. Cancellation status is independent of this summary.')).toBeVisible()
 await shot(page,'cancel-summary-unavailable')
 await page.unroute('**/rest/v1/rpc/get_owned_event_cancellation_summary')
 await page.getByRole('button',{name:'Refresh summary'}).click()
 await expect(page.getByText('Eligible amount',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Review notice recipients'}).click()
 await page.getByRole('button',{name:'Submit reviewed notice'}).click()
 await expect(page.getByText('1 message queued. This does not confirm sending or delivery.')).toBeVisible()
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await shot(page,`paid-cancelled-${width}`)}
 await settingsRoundTrip(page,fixture.eventId,'cancellation','Event cancelled')
 await page.getByRole('button',{name:'Review notice recipients'}).click()
 await expect(page.getByRole('button',{name:'Submit reviewed notice'})).toBeDisabled()
 const cancelled=await deliver(page,fixture.eventId,'event_cancellation')
 const buyer=await browser.newPage();await connect(buyer)
 await buyer.goto(`${origin}/event-status#${cancelled.text.match(/#(em1_[A-Za-z0-9_-]{43})/)![1]}`)
 await expect(buyer.getByRole('heading',{name:'Event cancelled',exact:true})).toBeVisible()
 await expect(buyer.getByText(/^Used ·/)).toHaveCount(1)
 await expect(buyer.getByText('Cancelled · Not valid for entry',{exact:true})).toHaveCount(2)
 await expect(buyer.getByRole('link',{name:'View your tickets'})).toHaveCount(0)
 await expect(buyer.locator('canvas')).toHaveCount(0)
 for(const width of [320,390,768,1440]){await buyer.setViewportSize({width,height:900});await shot(buyer,`buyer-paid-${width}`)}
 await buyer.reload();await expect(buyer.getByRole('heading',{name:'Event cancelled',exact:true})).toBeVisible()
 await buyer.goto(`${origin}/tickets/${fixture.paidToken}`)
 await expect(buyer.locator('.buyer-wallet-row')).toHaveCount(3)
 await expect(buyer.getByText('Event cancelled. Each ticket keeps its admission history.',{exact:true})).toBeVisible()
 await expect(buyer.locator('canvas')).toHaveCount(0)
 await shot(buyer,'paid-original-link')
 await buyer.getByRole('link',{name:/, Cancelled$/}).first().click()
 await expect(buyer.getByRole('heading',{name:'Cancelled',exact:true})).toBeVisible()
 await expect(buyer.getByLabel('Admission QR code')).toHaveCount(0)
 await shot(buyer,'paid-inactive-focused')
 const free=await browser.newPage();await connect(free,fixture.freeOwnerId)
 await free.goto(`${origin}/organizer/events/${fixture.freeEventId}/cancellation`)
 await free.getByRole('button',{name:'Cancel event',exact:true}).click()
 await free.getByRole('button',{name:'Confirm cancellation',exact:true}).click()
 await expect(free.getByRole('heading',{name:'Event cancelled',exact:true})).toBeVisible()
 await expect(free.getByText('Payments and refunds: Not applicable to free registrations.')).toBeVisible()
 await free.getByRole('button',{name:'Review notice recipients'}).click();await free.getByRole('button',{name:'Submit reviewed notice'}).click()
 await expect(free.getByText('1 message queued. This does not confirm sending or delivery.')).toBeVisible()
 for(const width of [320,390,768,1440]){await free.setViewportSize({width,height:900});await shot(free,`free-cancelled-${width}`)}
 const freeMessage=await deliver(free,fixture.freeEventId,'event_cancellation')
 await buyer.goto(`${origin}/event-status#${freeMessage.text.match(/#(em1_[A-Za-z0-9_-]{43})/)![1]}`)
 await expect(buyer.getByRole('heading',{name:'Free registration',exact:true})).toBeVisible()
 await expect(buyer.getByText(/^Used ·/)).toHaveCount(1);await expect(buyer.getByText('Cancelled · Not valid for entry',{exact:true})).toHaveCount(1)
 await expect(buyer.locator('canvas')).toHaveCount(0);for(const width of [320,390,768,1440]){await buyer.setViewportSize({width,height:900});await shot(buyer,`buyer-free-${width}`)}
 await buyer.goto(`${origin}/tickets/rsvp_${fixture.freeToken}`)
 await expect(buyer.locator('.buyer-wallet-row')).toHaveCount(2);await buyer.getByRole('link',{name:/, Cancelled$/}).click();await expect(buyer.getByRole('heading',{name:'Cancelled',exact:true})).toBeVisible();await expect(buyer.getByLabel('Admission QR code')).toHaveCount(0)
 await buyer.unrouteAll({behavior:'wait'}); await free.unrouteAll({behavior:'wait'}); await buyer.close();await free.close()
 const profileEvent = fixture.freeEventId.slice(0,-1)+'2'
 const beforeRevision = sql(`select content_revision from public.events where id='${profileEvent}';`)
 await page.goto('/organizer/settings/profile')
 await page.getByLabel('Organizer display name').fill('Harbor Organizer Updated')
 await page.getByRole('button',{name:'Save profile',exact:true}).click()
 await expect(page.getByText('Organizer profile saved.')).toBeVisible()
 // Paid event remains canonically cancelled; the other owner's event is unaffected.
 expect(sql(`select status from public.events where id='${fixture.eventId}';`)).toContain('cancelled')
 expect(sql(`select content_revision from public.events where id='${profileEvent}';`)).toBe(beforeRevision)

 sql('update private.ticket_email_settings set worker_enabled=false;')
})

test('ambiguous cancellation remains Unknown until same-event reconciliation authorizes deliberate retry',async({page})=>{
 const eventId=fixture.freeEventId.slice(0,-1)+'2'
 await connect(page,fixture.freeOwnerId)
 let failRead=false
 await page.route('**/rest/v1/events?*',route=>failRead ? route.fulfill({status:400,body:'{}',headers:{'access-control-allow-origin':origin}}) : route.fallback())
 await page.route('**/rest/v1/rpc/cancel_owned_event',route=>{failRead=true;return route.fulfill({status:503,body:'{}',headers:{'access-control-allow-origin':origin}})})
 await page.goto(`/organizer/events/${eventId}/cancellation`)
 await page.getByRole('button',{name:'Cancel event',exact:true}).click()
 await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click()
 await expect(page.getByText(/Cancellation status unknown/)).toBeVisible()
 await expect(page.getByRole('button',{name:'Confirm cancellation',exact:true})).toBeDisabled()
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await shot(page,`cancellation-unknown-${width}`)}
 await page.getByRole('button',{name:'Check cancellation status'}).click()
 await expect(page.getByText(/Cancellation status unknown/)).toBeVisible()
 failRead=false
 await page.getByRole('button',{name:'Check cancellation status'}).click()
 await expect(page.getByText(/server confirmed this event is still published/)).toBeVisible()
 await expect(page.getByRole('button',{name:'Try cancellation again'})).toBeEnabled()
 await page.unroute('**/rest/v1/rpc/cancel_owned_event')
 await page.getByRole('button',{name:'Try cancellation again'}).click()
 await expect(page.getByRole('heading',{name:'Event cancelled',exact:true})).toBeVisible()
 // Confirmation intentionally precedes these independent reads. Keep the
 // transport alive until both have rendered before disposing the browser.
 await expect(page.getByText('Payments and refunds: Not applicable to free registrations.')).toBeVisible()
 await expect(page.getByText('Total messages',{exact:true})).toBeVisible()
})
