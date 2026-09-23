import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import handler from '../../api/storefront.ts'
const env=await readFile('.env.local','utf8')
for(const line of env.split('\n')){const at=line.indexOf('=');if(at>0)process.env[line.slice(0,at)]=line.slice(at+1)}
assert.equal(process.env.VITE_SUPABASE_URL,'http://127.0.0.1:57321')
process.env.APP_BASE_URL='http://127.0.0.1:3070'
const server=createServer((req,res)=>void handler(req,res));await new Promise<void>(resolve=>server.listen(3071,'127.0.0.1',resolve))
try{
 const result=await fetch('http://127.0.0.1:3071/night-sessions');const html=await result.text()
 assert.equal(result.status,200);assert.match(html,/<title>Night Sessions \| Wheretoo<\/title>/);assert.match(html,/property="og:image"/);assert.match(html,/rel="canonical" href="http:\/\/127.0.0.1:3070\/night-sessions"/);assert.match(html,/src="\/assets\/index-/);assert.match(html,/img-src 'self' data: blob:/);assert.equal(result.headers.get('cache-control'),'private, no-store')
 const missing=await fetch('http://127.0.0.1:3071/never-claimed-handle');assert.equal(missing.status,404);assert.match(await missing.text(),/name="robots" content="noindex"/)
 const reserved=await fetch('http://127.0.0.1:3071/discover');assert.equal(reserved.status,200);assert.doesNotMatch(await reserved.text(),/property="og:title"/)
 console.log('PASS 11 built-template metadata HTTP assertions against real local public DTO; reserved route and 404 boundary preserved.')
}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
