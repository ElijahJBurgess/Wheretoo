// Local-only browser proof against the dedicated mock-provider stack.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium, expect } from '@playwright/test'
const config=JSON.parse(execFileSync('corepack',['pnpm@11.19.0','exec','supabase','status','--workdir','.supabase/ai-cover','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}))
if(config.API_URL!=='http://127.0.0.1:56321')throw new Error('Local stack required')
const service=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const email=`ai-cover-browser-${crypto.randomUUID()}@example.invalid`, password='LocalCoverBrowser123!'
const {data:created,error:createError}=await service.auth.admin.createUser({email,password,email_confirm:true})
if(createError)throw createError
const owner=created.user.id
const eventId=crypto.randomUUID()
execFileSync('docker',['exec','-i','supabase_db_wheretoo-ai-cover-phase1','psql','-X','-U','postgres','-v','ON_ERROR_STOP=1'],{input:`insert into public.organizers(id,display_name,onboarding_completed_at) values('${owner}','Local cover organizer',now());
insert into public.events(id,organizer_id,title,description,category,city,venue_name) values('${eventId}','${owner}','Garden jazz ${eventId.slice(0,8)}','An evening of live jazz in a neighborhood garden.','music','Oakland','Garden Hall');`,stdio:['pipe','ignore','pipe']})
const auth=createClient(config.API_URL,config.ANON_KEY,{auth:{persistSession:false}})
const {data:login,error:loginError}=await auth.auth.signInWithPassword({email,password})
if(loginError)throw loginError
const browser=await chromium.launch({headless:true})
const page=await browser.newPage({viewport:{width:1280,height:960}})
await page.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),login.session)
await page.route('**/*',route=>['http://127.0.0.1:3050','http://127.0.0.1:56321'].includes(new URL(route.request().url()).origin)?route.continue():route.abort())
const errors=[];page.on('pageerror',error=>errors.push(error.message))
mkdirSync('.supabase/ai-cover/visual',{recursive:true})
try {
 await page.goto(`http://127.0.0.1:3050/organizer/events/${eventId}/edit?step=basics`)
 await page.getByRole('button',{name:'Generate with AI',exact:true}).click()
 await page.getByLabel('Mood',{exact:true}).selectOption('Community')
 await page.getByLabel('Creative direction').fill('Warm garden light')
 await page.getByRole('button',{name:'Generate 3 covers',exact:true}).click()
 await expect(page.getByAltText('AI cover option 1')).toBeVisible({timeout:30000})
 await expect(page.getByAltText('AI cover option 3')).toBeVisible({timeout:30000})
 await expect(page.getByRole('button',{name:'Retry cover 2'})).toBeEnabled({timeout:25000})
 await page.locator('.ai-cover-chooser').screenshot({path:'.supabase/ai-cover/visual/desktop-partial.png'})
 await page.getByRole('button',{name:'Retry cover 2'}).click()
 await expect(page.getByAltText('AI cover option 2')).toBeVisible({timeout:30000})
 await page.reload()
 await expect(page.getByAltText('AI cover option 2')).toBeVisible({timeout:30000})
 await page.setViewportSize({width:390,height:844})
 await page.locator('.ai-cover-chooser').screenshot({path:'.supabase/ai-cover/visual/mobile-ready.png'})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.getByRole('button',{name:'Use this cover',exact:true}).first().click()
 await expect(page.getByText('Cover 1 was selected.',{exact:true})).toBeVisible()
 await expect(page.getByLabel('Replace flyer',{exact:true})).toBeEnabled()
 const {readFileSync}=await import('node:fs')
 const fixtures=JSON.parse(readFileSync('.supabase/ai-cover/supabase/functions/event-cover-generation/fixtures.json','utf8'))
 await page.getByLabel('Replace flyer',{exact:true}).setInputFiles({name:'manual.png',mimeType:'image/png',buffer:Buffer.from(fixtures[2],'base64')})
 await expect(page.getByText('Your cover changed or these options expired. Generate a new set to continue.',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Remove flyer',exact:true}).click()
 await expect(page.getByLabel('Upload flyer',{exact:true})).toBeEnabled()
 expect(errors).toEqual([])
 console.log('PASS browser: generate, partial failure, retry, reload, mobile selection, manual replace/remove; no overflow or runtime errors')
} catch(error) {
 await page.screenshot({path:'.supabase/ai-cover/visual/failure.png',fullPage:true})
 console.error(await page.locator('body').innerText())
 throw error
} finally {await browser.close()}
