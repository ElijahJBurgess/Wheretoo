import { readFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'
export const f=JSON.parse(readFileSync('.superpowers/waitlist-proof/browser.json','utf8')) as {api:string;edge:string;origin:string;anon:string;owner:string;otherOwner:string;token:string;otherToken:string;event:string;tier:string;otherTier:string}
export function sql(statement:string){return execFileSync('docker',['exec','-i','supabase_db_wheretoo-waitlist','psql','-X','-U','postgres','-At','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8'}).trim()}
export async function connect(page:Page,actor?:'owner'|'other'){
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
  if(url.origin==='https://waitlist-proof-local.supabase.co'){
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':f.origin,'access-control-allow-headers':'*','access-control-allow-methods':'*'}})
   const target=(url.pathname.startsWith('/functions/')?f.edge:f.api)+url.pathname+url.search
   const response=await route.fetch({url:target,headers:{...request.headers(),origin:f.origin}})
   return route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':f.origin}})
  }
  if(url.origin!==f.origin&&url.protocol!=='blob:'&&url.protocol!=='data:')return route.abort('blockedbyclient')
  return route.continue()
 })
 if(actor)await page.addInitScript(({owner,token})=>localStorage.setItem('sb-waitlist-proof-local-auth-token',JSON.stringify({access_token:token,refresh_token:'local-fixture-only',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:owner,email:'owner@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}})),{owner:actor==='owner'?f.owner:f.otherOwner,token:actor==='owner'?f.token:f.otherToken})
}
export async function shot(page:Page,name:string){mkdirSync('.superpowers/waitlist-proof/screens',{recursive:true});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`.superpowers/waitlist-proof/screens/${name}.png`,fullPage:!name.startsWith('owner')})}
