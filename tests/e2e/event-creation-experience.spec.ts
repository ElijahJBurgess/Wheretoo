import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
const fixture = JSON.parse(readFileSync(new URL('../../.superpowers/public-availability/browser-fixtures.json', import.meta.url), 'utf8')) as { api: string; session: unknown; events: Record<string,string> }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
const imageId = 'a9293000-0000-4000-8000-000000000001', generationId = 'a9294000-0000-4000-8000-000000000001'

async function transport(page: Page) {
 const errors: string[] = []
 const state = { revision: 0, image: false, generation: false, selected: false, eventId: '', failUpload: false, failAi: false }
 page.on('pageerror', e => errors.push(e.message))
 await page.addInitScript(session => localStorage.setItem('sb-127-auth-token', JSON.stringify(session)), fixture.session)
 await page.route('**/*', async route => {
  const request = route.request(), u = new URL(request.url())
  const json = (body: unknown, status=200) => route.fulfill({status, json: body})
  if (u.origin === 'http://127.0.0.1:3094') return route.continue()
  if (u.hostname === 'api.mapbox.com') {
   const second = u.searchParams.get('q')?.includes('Second') || u.pathname.includes('second')
   const address = second ? '2 Market Street' : '1 Market Street'
   if (u.pathname.includes('/suggest')) return json({ suggestions: [{name: address,mapbox_id: second ? 'second' : 'first',feature_type:'address',address,full_address: `${address}, San Francisco, CA 94105`,place_formatted:'San Francisco, CA 94105'}], attribution:'© Mapbox' })
   if (u.pathname.includes('/retrieve')) return json({type:'FeatureCollection', features:[{type:'Feature',geometry:{type:'Point',coordinates:[-122.3958,37.7936]},properties:{mapbox_id:second?'second':'first',feature_type:'address',name:address,address,context:{country:{country_code:'US',country_code_alpha_3:'USA',name:'United States'},region:{region_code:'CA',region_code_full:'US-CA',name:'California'},postcode:{name:'94105'},place:{name:'San Francisco'}},coordinates:{longitude:-122.3958,latitude:37.7936}}}]})
   errors.push(`Unexpected Mapbox request ${u.pathname}`); return route.abort()
  }
  if (u.origin !== fixture.api) { errors.push(`External request ${u.origin}`); return route.abort() }
  const images = () => state.image ? [{id:imageId,eventId:state.eventId,path:'proof/image.png',position:1,owned:true}] : []
  if (u.pathname.endsWith('/rpc/get_event_cover_state')) { state.eventId=request.postDataJSON().p_event_id; return json({revision:state.revision,latestGenerationId:state.generation?generationId:null,images:images()}) }
  if (u.pathname.endsWith('/rpc/list_event_images')) return json(images())
  if (u.pathname.includes('/storage/v1/object/sign/') && request.method()==='POST') return json(request.postDataJSON().paths.map((path:string)=>({path,signedURL:'/object/sign/proof/image.png?token=local'})))
  if (u.pathname.includes('/storage/v1/object/sign/')) return route.fulfill({contentType:'image/png',body:png})
  if (u.pathname.endsWith('/functions/v1/event-images')) {
   if (state.failUpload) return json({error:'private diagnostic'},503)
   state.image = request.method()==='POST' || !request.postDataJSON().remove
   if (request.method()==='PUT' && request.postDataJSON().generationId) state.selected=true
   state.revision++; return json({revision:state.revision})
  }
  if (u.pathname.endsWith('/functions/v1/event-cover-generation')) {
   if (state.failAi) return json({error:'PROVIDER_FAILED'},503)
   state.generation=true
   return json({id:generationId,eventId:state.eventId,expectedRevision:state.selected?state.revision-1:state.revision,input:{mood:'Editorial',direction:''},selectedSlot:state.selected?1:null,expired:false,expiresAt:'2099-01-01T00:00:00Z',candidates:[1,2,3].map(slot=>({id:`a9295000-0000-4000-8000-00000000000${slot}`,slot,status:'ready',path:`proof/${slot}.png`,failureCode:null,attempts:1,retryAfter:'2000-01-01T00:00:00Z'}))})
  }
  if (u.pathname.endsWith('/functions/v1/stripe-connect-status')) return json({status:'ready',requirements_currently_due_count:0,requirements_past_due_count:0,last_status_code:null,last_synced_at:new Date().toISOString()})
  return route.continue() // Only the explicitly verified localhost API remains real.
 })
 return {state,errors}
}
async function layout(page:Page) {
 await page.evaluate(()=>document.fonts.ready)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 for (const input of await page.locator('input[type=date],input[type=time]').all()) {
  const box=await input.boundingBox(); expect(box?.width).toBeGreaterThan(90)
  expect(box!.x+box!.width).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth))
 }
}
async function details(page:Page) {
 await page.getByLabel('Event name').fill('Local neighborhood gathering')
 await page.getByLabel('Description',{exact:true}).fill('A calm gathering for neighbors and local makers.')
 await page.getByLabel('Category',{exact:true}).selectOption('community')
}
async function whenWhere(page:Page) {
 const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10)
 await expect(page).toHaveURL(/edit\?step=date-location/)
 await page.getByLabel('Start date').fill(date)
 await expect(page.getByLabel('Start date')).toHaveValue(date)
 await page.getByLabel('Start time').fill('17:00')
 await expect(page.getByLabel('Start date')).toHaveValue(date)
 await page.getByLabel('End date').fill(date); await page.getByLabel('End time').fill('19:00')
 await page.getByLabel('Venue name').fill('Community Hall')
 await page.getByRole('combobox').fill('Market Street')
 await page.getByRole('option').first().click()
 await expect(page.getByText('Verified address')).toBeVisible()
 await expect(page.getByRole('combobox')).toHaveCount(0)
 await page.getByRole('button',{name:'Change address'}).click()
 await page.getByRole('combobox').fill('Second address')
 await page.getByRole('option').first().click()
 await expect(page.getByText('2 Market Street',{exact:true})).toBeVisible()
}
for (const width of [390,1440]) {
 for (const paid of [false,true]) test(`new ${paid?'paid':'free'} creation and publish at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900}); const {errors}=await transport(page)
  await page.goto('/organizer/events/new'); await details(page)
  await expect(page.getByRole('navigation',{name:'Event creation progress'}).getByRole('listitem')).toHaveCount(4)
  await layout(page); await page.screenshot({path:info.outputPath('details.png'),fullPage:true})
  await page.getByRole('button',{name:'Continue',exact:true}).click(); await whenWhere(page)
  const createdId = new URL(page.url()).pathname.split('/')[3]
  await layout(page); await page.screenshot({path:info.outputPath('when-where.png'),fullPage:true})
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.getByRole('button',{name:'Back',exact:true}).click()
  await expect(page.getByLabel('Start time')).toHaveValue('17:00')
  await page.reload(); await expect(page.getByLabel('End time')).toHaveValue('19:00')
  await expect(page.getByText('2 Market Street',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.getByRole('radio',{name:paid?/Paid Tickets/:/Free RSVP/}).check()
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  if(paid){
   await page.getByRole('button',{name:'Add ticket tier',exact:true}).click()
   await page.getByLabel('Name',{exact:true}).fill('General admission')
   await page.getByLabel('Price for General admission').fill('12')
   await page.getByLabel('Capacity',{exact:true}).fill('30')
   await page.getByRole('button',{name:'Continue',exact:true}).click()
  }
  await expect(page.getByRole('heading',{name:'Review',exact:true})).toBeVisible()
  await expect(page.getByLabel('Upload image')).toHaveCount(0)
  await page.getByLabel('Minimum age').selectOption('all_ages')
  for(const radio of await page.getByRole('radio',{name:'No',exact:true}).all()) await radio.check()
  await page.getByRole('checkbox').check() // Synthetic local development policies only.
  await layout(page); await page.screenshot({path:info.outputPath('review.png'),fullPage:true})
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.getByRole('button',{name:'Publish event',exact:true}).click()
  await page.getByRole('button',{name:'Confirm and publish'}).click()
  await expect(page.getByRole('heading',{name:'Your event is live!'})).toBeVisible()
  await page.getByRole('link',{name:'View event',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Local neighborhood gathering',exact:true})).toBeVisible()
  const contextResponse = page.waitForResponse(r => r.url().endsWith('/rpc/get_owned_event_change_context'))
  await page.goto(`/organizer/events/${createdId}/edit`)
  const before = (await (await contextResponse).json()).event
  await expect(page.getByRole('heading',{name:'Event Details',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Change image'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Generate with AI'})).toHaveCount(0)
  await layout(page); await page.screenshot({path:info.outputPath('published-edit.png'),fullPage:true})
  await page.getByRole('button',{name:'Continue to date & location'}).click()
  await expect(page.getByLabel('Start time')).toHaveValue('17:00')
  await expect(page.getByText('2 Market Street',{exact:true})).toBeVisible()
  const saveResponse = page.waitForResponse(r => r.url().endsWith('/rpc/save_owned_event_revision_if_current'))
  await page.getByRole('button',{name:'Save changes',exact:true}).click()
  const response = await saveResponse
  expect(response.ok()).toBe(true)
  const after = (await response.json()).context.event
  for (const field of ['starts_at','ends_at','timezone','mapbox_feature_id','address_line1','address_line2','city','region','postal_code','country_code','latitude','longitude','admission_type']) expect(after[field]).toEqual(before[field])
  expect(errors).toEqual([])
 })
 test(`image upload AI and compact existing editing at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900}); const {state,errors}=await transport(page)
  await page.goto('/organizer/events/new'); await details(page)
  await page.getByLabel('Upload image').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:png})
  await expect(page).toHaveURL(/edit\?step=basics/)
  await expect(page.getByAltText('Event image',{exact:true})).toBeVisible()
  await page.reload(); await expect(page.getByAltText('Event image',{exact:true})).toBeVisible()
  const url=new URL(page.url()); const id=url.pathname.split('/')[3]
  state.failUpload=true
  await page.getByLabel('Replace image').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:png})
  await expect(page.getByRole('alert')).toContainText('could not be confirmed')
  expect(state.image).toBe(true); state.failUpload=false
  await page.getByRole('button',{name:'Generate with AI'}).click()
  state.failAi=true; await page.getByRole('button',{name:'Generate 3 covers'}).click()
  await expect(page.getByRole('alert')).toContainText('Generation could not be confirmed')
  expect(state.image).toBe(true); state.failAi=false
  await page.getByRole('button',{name:'Generate 3 covers'}).click()
  await expect(page.getByAltText('AI cover option 1')).toBeVisible()
  await layout(page); await page.screenshot({path:info.outputPath('ai-panel.png'),fullPage:true})
  await page.getByRole('button',{name:'Use this image'}).first().click()
  await expect(page.getByRole('region',{name:'Generate event image'})).toHaveCount(0)
  expect(state.selected).toBe(true)
  await page.reload(); await expect(page.getByAltText('Event image',{exact:true})).toBeVisible()
  await expect(page.getByRole('region',{name:'Generate event image'})).toHaveCount(0)
  await page.goto(`/organizer/events/${id}/edit`)
  await expect(page.getByRole('heading',{name:'Event Details',exact:true})).toBeVisible()
  await expect(page.getByLabel('Replace image')).toHaveCount(0)
  await page.getByRole('button',{name:'Change image'}).click()
  await expect(page.getByLabel('Replace image')).toBeVisible()
  await layout(page); await page.screenshot({path:info.outputPath('existing-edit.png'),fullPage:true})
  await page.getByRole('button',{name:'Remove image'}).click()
  await expect(page.getByAltText('Event image',{exact:true})).toHaveCount(0)
  expect(errors).toEqual([])
 })
}

test('AI-first draft handoff is consumed after closing and reload', async ({page}) => {
 const {errors}=await transport(page)
 await page.goto('/organizer/events/new'); await details(page)
 await page.getByRole('button',{name:'Generate with AI'}).click()
 await expect(page.getByRole('region',{name:'Generate event image'})).toBeVisible()
 await page.getByRole('button',{name:'Close',exact:true}).click()
 await page.reload()
 await expect(page.getByLabel('Event name')).toHaveValue('Local neighborhood gathering')
 await expect(page.getByRole('region',{name:'Generate event image'})).toHaveCount(0)
 expect(errors).toEqual([])
})
