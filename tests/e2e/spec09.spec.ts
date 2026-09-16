import {test,expect,type Page} from '@playwright/test'
import {createHmac} from 'node:crypto'
import {readFileSync,mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
const edge='http://127.0.0.1:55567',origin='http://127.0.0.1:3029'
execFileSync('python3',['tests/integration/spec09-browser-fixture.py'],{stdio:'pipe'})
const fixture=JSON.parse(readFileSync('.superpowers/spec08-spec09/browser-fixture.json','utf8')) as {ownerId:string;eventId:string;orderId:string;paidToken:string}
function sql(statement:string){return execFileSync('python3',['tests/integration/spec08-spec09-database.py','sql'],{input:statement,encoding:'utf8'})}
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
 if(owner)await page.addInitScript(({owner,access})=>localStorage.setItem('sb-spec10-local-auth-token',JSON.stringify({access_token:access,refresh_token:'local-only',expires_at:1893456000,expires_in:9999999,token_type:'bearer',user:{id:owner,email:'owner@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}})),{owner,access:jwt(owner)})
}
const url=(view:string)=>view === 'buyer' ? `${origin}/refund-details` : `${origin}/organizer/events/${fixture.eventId}/orders/${fixture.orderId}`
async function shot(page:Page,name:string){mkdirSync('.superpowers/spec08-spec09/browser-visual',{recursive:true});await page.screenshot({path:`.superpowers/spec08-spec09/browser-visual/${name}.png`,fullPage:!(await page.getByRole('dialog').count())});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)}
test('whole order journey uses production UI, durable Edge handler, canonical DB and purpose-specific notice access',async({page,browser})=>{
 const before=(await(await page.request.get(edge+'/__spec09/refund-proof')).json()).creates
 const originalBuyer = await browser.newPage(); await connect(originalBuyer)
 await originalBuyer.goto(`${origin}/orders/${fixture.paidToken}`)
 await expect(originalBuyer.getByRole('heading', {name: "You're all set"})).toBeVisible()
 await expect(originalBuyer.getByRole('button', {name:'Add to calendar'})).toBeVisible()
 await expect(originalBuyer.getByRole('link', {name:'View tickets'})).toHaveAttribute('href', `/tickets/${fixture.paidToken}`)
 await originalBuyer.getByRole('link', {name:'View tickets'}).click()
 await expect(originalBuyer.locator('.buyer-wallet-row')).toHaveCount(3)
 const originalCollection = await originalBuyer.request.post(edge+'/functions/v1/ticket-collection', {headers:{origin},data:{collectionBearer:fixture.paidToken}})
 const original = await originalCollection.json()
 expect(original.kind).toBe('ready')
 const valid = original.collection.tickets.find((ticket:{status:string})=>ticket.status==='valid')
 await originalBuyer.goto(`${origin}/tickets/${fixture.paidToken}/${valid.selector}`)
 await expect(originalBuyer.getByLabel('Admission QR code')).toHaveAttribute('data-qr-ready','true')
 const originalQr = await originalBuyer.getByLabel('Admission QR code').evaluate(node=>(node as HTMLCanvasElement).toDataURL())
 await originalBuyer.reload()
 await expect(originalBuyer.getByLabel('Admission QR code')).toHaveAttribute('data-qr-ready','true')
 expect(await originalBuyer.getByLabel('Admission QR code').evaluate(node=>(node as HTMLCanvasElement).toDataURL())).toBe(originalQr)
 await connect(page,fixture.ownerId)
 await page.goto(url('order'))
 await expect(page.getByRole('button',{name:'Refund order',exact:true})).toBeEnabled()
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await shot(page,`eligible-${width}`)}
 await page.setViewportSize({width:390,height:844})
 await page.getByRole('button',{name:'Refund order',exact:true}).click()
 await expect(page.getByRole('dialog')).toContainText('$70')
 await expect(page.getByRole('dialog')).toContainText('Used')
 const dialogBox=await page.getByRole('dialog').boundingBox();const titleBox=await page.getByRole('heading',{name:'Refund this order?'}).boundingBox();expect(titleBox!.y).toBeGreaterThanOrEqual(dialogBox!.y)
 await shot(page,'confirm-390')
 await page.getByRole('button',{name:'Cancel',exact:true}).click()
 expect((await (await page.request.get(edge+'/__spec09/refund-proof')).json()).creates).toBe(before)
 await page.getByRole('button',{name:'Refund order',exact:true}).click()
 await page.getByRole('button',{name:'Confirm refund',exact:true}).click()
 await expect(page.getByRole('dialog')).toContainText('processing')
 await page.getByRole('button',{name:'Done',exact:true}).click()
 await expect(page.getByRole('button',{name:'Resend tickets',exact:true})).toBeDisabled()
 await page.reload();await expect(page.getByRole('button',{name:'Check existing refund'})).toBeVisible()
 await page.getByRole('button',{name:'Check existing refund'}).click()
 const proof=await(await page.request.get(edge+'/__spec09/refund-proof')).json()
 expect(proof.creates).toBe(before+1)
 expect(proof.parameters.at(-1).params).toMatchObject({amount:7000,reverse_transfer:true,refund_application_fee:true})
 await shot(page,'processing-390')
 for(const [state,heading] of [['unknown','Refund outcome unknown'],['failed','Refund failed'],['review','Refund needs review']]){
  sql(`select public.server_note_refund_observation('${fixture.ownerId}','${fixture.eventId}','${fixture.orderId}','${state}',${state==='review'?"'re_conflictingbrowser'":'null'});`)
  await page.reload();await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Resend tickets',exact:true})).toBeDisabled();await shot(page,state+'-390')
 }

 // Synthetic signed-event receipt + exact canonical SQL writer. Signature transport has separate Deno tests.
 sql(`select * from public.server_record_webhook_receipt('evt_spec09browser${fixture.orderId.replaceAll("-","")}','refund.updated',false,'re_spec09browser${fixture.orderId.replaceAll("-","")}','2026-07-29.dahlia',now(),repeat('c',64));
 select public.server_apply_verified_refund('evt_spec09browser${fixture.orderId.replaceAll("-","")}',o.id,'re_spec09browser${fixture.orderId.replaceAll("-","")}',o.stripe_payment_intent_id,o.stripe_charge_id,'trr_spec09browser${fixture.orderId.replaceAll("-","")}','fr_spec09browser${fixture.orderId.replaceAll("-","")}',o.total_minor,'usd','succeeded','requested_by_customer',true,true,o.total_minor,o.application_fee_amount_minor,true,null) from public.orders o where o.id='${fixture.orderId}';`)
 await page.reload();await expect(page.getByText('Refund complete',{exact:true}).first()).toBeVisible()
 sql(`begin; set local role authenticated; set local request.jwt.claim.sub='${fixture.ownerId}'; select public.cancel_owned_event('${fixture.eventId}'); commit;`)
 const financialBeforeSettings=sql(`select to_jsonb(o) from public.orders o where id='${fixture.orderId}';`)
 await page.getByRole('link',{name:'Settings',exact:true}).first().click()
 await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible()
 await page.goto(url('order'))
 await expect(page.getByText('Refund complete',{exact:true}).first()).toBeVisible()
 expect(sql(`select to_jsonb(o) from public.orders o where id='${fixture.orderId}';`)).toBe(financialBeforeSettings)
 expect(sql(`select status from public.events where id='${fixture.eventId}';`)).toContain('cancelled')

 await originalBuyer.goto(`${origin}/orders/${fixture.paidToken}`)
 await expect(originalBuyer.getByRole('heading',{name:'This order was refunded'})).toBeVisible()
 await expect(originalBuyer.getByText(/Previously used tickets keep their check-in history/)).toBeVisible()
 await originalBuyer.goto(`${origin}/tickets/${fixture.paidToken}/${valid.selector}`)
 await expect(originalBuyer.getByRole('heading',{name:'Refunded',exact:true})).toBeVisible()
 await expect(originalBuyer.getByLabel('Admission QR code')).toHaveCount(0)
 await expect(originalBuyer.getByText(/Previously used tickets keep their check-in history/)).toBeVisible()
 const finalCollection = await originalBuyer.request.post(edge+'/functions/v1/ticket-collection', {headers:{origin},data:{collectionBearer:fixture.paidToken}})
 const final = await finalCollection.json()
 expect(final.kind).toBe('ready')
 expect(final.collection.tickets.map((ticket:{selector:string})=>ticket.selector)).toEqual(original.collection.tickets.map((ticket:{selector:string})=>ticket.selector))
 expect(final.collection.tickets.map((ticket:{status:string})=>ticket.status).sort()).toEqual(['refunded','refunded','used'])
 expect(final.collection.tickets.every((ticket:{admissionCredential:null})=>ticket.admissionCredential===null)).toBe(true)
 await originalBuyer.close()

 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await shot(page,`completed-${width}`)}
 for(let pass=0;pass<4;pass++) { const worker=await page.request.post(edge+'/__spec09/work',{data:{mode:'accepted'}});expect(worker.ok()).toBe(true) }
 const messages=await(await page.request.get(edge+'/__spec09/messages')).json() as {attemptId:string;text:string}[]
 const message=messages.find(m=>m.text.includes('/refund-details#') && m.text.includes(fixture.orderId.replaceAll('-','').toUpperCase()))!;expect(message).toBeTruthy()
 const token=message.text.match(/#(em1_[A-Za-z0-9_-]{43})/)![1]
 expect((await page.request.post(edge+'/__spec09/observe',{data:{attemptId:message.attemptId,kind:'delivered'}})).ok()).toBe(true)
 const buyer=await browser.newPage();await connect(buyer)
 await buyer.goto(url('buyer')+'#'+token)
 await expect(buyer.getByRole('heading',{name:'Your order has been refunded',exact:true})).toBeVisible()
 await expect(buyer.getByText('$70', {exact:true}).first()).toBeVisible()
 await expect(buyer.locator('canvas')).toHaveCount(0)
 expect(new URL(buyer.url()).hash).toBe('')
 await expect(buyer.getByText('Used', {exact:true})).toHaveCount(1)
 await expect(buyer.getByText('Refunded', {exact:true})).toHaveCount(2)
 await expect(buyer.getByText(/^Checked in ·/)).toHaveCount(1)
 expect(await buyer.content()).not.toContain('re_spec09browser')
 for(const width of [320,390,768,1440]){await buyer.setViewportSize({width,height:900});await shot(buyer,`buyer-${width}`)}
 await buyer.reload();await expect(buyer.getByRole('heading',{name:'Your order has been refunded',exact:true})).toBeVisible()
 // Original admission-purpose resolver refuses financial bearer.
 const cross=await buyer.request.post(edge+'/functions/v1/ticket-email-access',{headers:{origin},data:{token}});expect(await cross.text()).not.toContain('ready')
 sql(`select public.server_revoke_ticket_email_grant(g.id) from private.ticket_email_grants g join private.ticket_email_members m on m.grant_id=g.id where m.order_id='${fixture.orderId}' and g.purpose='refund_notice';`)
 await buyer.reload();await expect(buyer.getByRole('heading',{name:'Refund link unavailable'})).toBeVisible();await expect(buyer.getByText('$70',{exact:true})).toHaveCount(0);await shot(buyer,'revoked-1440')
 await buyer.close()
})
