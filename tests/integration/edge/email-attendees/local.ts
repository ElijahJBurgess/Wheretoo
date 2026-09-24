// Local-only proof. Run with --allow-net=127.0.0.1:61321[,127.0.0.1:61330].
// A denied network permission, plus injected provider transport, prevents real email.
import { assert, assertEquals } from '@std/assert';
import { createOrganizerMessageHandler } from '../../../../supabase/functions/organizer-message/index.ts';
import { processOrganizerMessage } from '../../../../supabase/functions/_shared/organizerMessageWorker.ts';
import { createTicketEmailWebhookHandler } from '../../../../supabase/functions/ticket-email-webhook/index.ts';
import { verifyProviderObservation } from '../../../../supabase/functions/_shared/ticketEmailProvider.ts';
import type { ProviderEmailPayload } from '../../../../supabase/functions/_shared/ticketEmailAccess.ts';

type Identity = { owner:string;token:string;event:string;tier?:string;order?:string;registration?:string;emptyEvent?:string };
type Fixture={api:string;anon:string;service:string;origin:string;edge:string;free:Identity;paid:Identity;other:Identity};
const f:Fixture=JSON.parse(await Deno.readTextFile('.superpowers/email-proof/browser.json'));
assertEquals(f.api,'http://127.0.0.1:61321');assertEquals(f.edge,'http://127.0.0.1:61330');
async function rpc(token:string,name:string,args:Record<string,unknown>={}){
 const r=await fetch(`${f.api}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:f.anon,authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(args)});
 const body=await r.json();return r.ok?{data:body,error:null}:{data:null,error:{code:String(body.code),message:String(body.message)}};
}
async function service(name:string,args:Record<string,unknown>={}){const result=await rpc(f.service,name,args);if(result.error)throw Error(`Local RPC ${name}: ${result.error.code} ${result.error.message}`);return result.data;}
const handler=createOrganizerMessageHandler({appOrigin:f.origin,rpc});
if(Deno.args.includes('--serve')){
 Deno.serve({hostname:'127.0.0.1',port:61330},request=>new URL(request.url).pathname==='/health'?new Response('Local proof only'):handler(request));
}else if(Deno.args.includes('--bulk')){
 const call=async(input:Record<string,unknown>)=>{
  const r=await handler(new Request(f.edge,{method:'POST',headers:{origin:f.origin,authorization:`Bearer ${f.free.token}`,'content-type':'application/json'},body:JSON.stringify({eventId:f.free.event,...input})}));
  assertEquals(r.status,200);return r.json();
 };
 const content={selector:{kind:'everyone'},subject:'Full local delivery proof',body:'Synthetic operational update.'};
 const p=await call({action:'preview',...content});assertEquals(p.preview.recipientCount,1000);
 const result=await call({action:'submit',...content,fingerprint:p.preview.fingerprint,requestId:crypto.randomUUID()});assertEquals(result.receipt.queuedRecipients,1000);
 console.log('PASS 1000-recipient immutable queue committed; browser request is complete before worker begins');
 const keys=new Set<string>();const recipients=new Set<string>();const config={keyId:'bulk-proof',keys:new Map([['bulk-proof',new Uint8Array(32).fill(19)]])};
 for(let i=0;i<1000;i++){
  const state=await processOrganizerMessage({config,rpc:service,now:Date.now,send:async(payload,key)=>{
   assert(!keys.has(key));assert(!recipients.has(payload.to));assertEquals(payload.html,p.preview.html);assertEquals(payload.text,p.preview.text);
   keys.add(key);recipients.add(payload.to);return {outcome:'accepted',providerId:'local-bulk-'+crypto.randomUUID()};
  }});
  assertEquals(state,'accepted');if((i+1)%100===0)console.log(`PASS ${i+1}/1000 accepted by injected local provider`);
 }
 assertEquals(await processOrganizerMessage({config,rpc:service,now:Date.now,send:()=>{throw Error('No extra delivery allowed');}}),'empty');
 console.log('PASS all 1000 distinct addresses,1000 stable distinct keys,exact preview bytes,no truncation or extra dispatch');Deno.exit(0);
}else{
 let passed=0;function check(condition:unknown,label:string){assert(condition,label);passed++;console.log(`PASS ${label}`);}
 async function action(actor:Identity,input:Record<string,unknown>){const response=await handler(new Request(f.edge,{method:'POST',headers:{origin:f.origin,authorization:`Bearer ${actor.token}`,'content-type':'application/json'},body:JSON.stringify({eventId:actor.event,...input})}));return {status:response.status,body:await response.json()};}
 const subject='Local organizer update 🌎';const body='Bring a jacket.\n<script>plain text</script>';
 for(const [actor,selector,count,label] of [[f.free,{kind:'everyone'},2,'free dedupe/group'],[f.free,{kind:'registration',id:f.free.registration},1,'free individual'],[f.paid,{kind:'everyone'},1,'paid multi-ticket'],[f.paid,{kind:'tier',id:f.paid.tier},1,'paid tier UUID'],[f.paid,{kind:'order',id:f.paid.order},1,'paid individual']] as const){
  const result=await action(actor,{action:'preview',selector,subject,body});check(result.status===200&&result.body.preview?.recipientCount===count,`real owner API ${label}`);
  const serialized=JSON.stringify(result.body);check(!serialized.includes('pat-')&&!serialized.includes('synthetic-buyer-'),'preview excludes destination addresses');
  check(result.body.preview.html.includes('&lt;script&gt;plain text&lt;/script&gt;'),'template escapes organizer text');
 }
 const denied=await action({...f.other,event:f.free.event},{action:'preview',selector:{kind:'everyone'},subject,body});check(denied.status!==200,'real JWT foreign organizer denied');
 const arbitrary=await action(f.free,{action:'preview',selector:{kind:'everyone',email:'arbitrary@example.invalid'},subject,body});check(arbitrary.status===400,'arbitrary recipient selector rejected before RPC');
 const empty=await action(f.free,{action:'preview',eventId:f.free.emptyEvent,selector:{kind:'everyone'},subject,body});check(empty.body.preview?.recipientCount===0,'zero audience remains visible');
 const preview=await action(f.free,{action:'preview',selector:{kind:'everyone'},subject,body});
 const requestId=crypto.randomUUID();const intent={action:'submit',selector:{kind:'everyone'},subject,body,fingerprint:preview.body.preview.fingerprint,requestId};
 const [one,two]=await Promise.all([action(f.free,intent),action(f.free,intent)]);assertEquals(one.status,200);assertEquals(one.body,two.body);check(one.body.receipt.queuedRecipients===2,'concurrent HTTP confirmation yields one identical durable receipt');
 const receipt=await action(f.free,{action:'receipt',requestId});assertEquals(receipt.body,one.body);check(true,'receipt recovers committed response');
 const conflicting=await action(f.free,{...intent,subject:'Changed intent'});check(conflicting.body.error.code==='REQUEST_CONFLICT','changed intent conflicts');
 const config={keyId:'local-proof',keys:new Map([['local-proof',new Uint8Array(32).fill(17)]])};
 const deliveries:{payload:ProviderEmailPayload;key:string}[]=[];
 const result1=await processOrganizerMessage({config,rpc:service,now:Date.now,send:async(payload,key)=>{deliveries.push({payload,key});return {outcome:'accepted',providerId:'local-provider-'+crypto.randomUUID()};}});
 const result2=await processOrganizerMessage({config,rpc:service,now:Date.now,send:async(payload,key)=>{deliveries.push({payload,key});return {outcome:'failed'};}});
 assertEquals([result1,result2],['accepted','failed']);check(deliveries.length===2&&deliveries[0].payload.to!==deliveries[1].payload.to,'independent worker delivers each unique snapshot recipient; sibling failure isolated');
 check(deliveries.every(d=>d.payload.html===preview.body.preview.html&&d.payload.text===preview.body.preview.text),'preview and dispatched immutable template match exactly');
 check(deliveries.every(d=>d.key==='organizer-message/'+d.payload.tags[0].value&&!JSON.stringify(d.payload).includes('/ticket-access')),'independent idempotency keys and no ticket access bearer');
 const paidPreview=await action(f.paid,{action:'preview',selector:{kind:'everyone'},subject,body});
 const paidSend=await action(f.paid,{action:'submit',selector:{kind:'everyone'},subject,body,fingerprint:paidPreview.body.preview.fingerprint,requestId:crypto.randomUUID()});assertEquals(paidSend.status,200);
 let unknownAttempt='';const unknown=await processOrganizerMessage({config,rpc:service,now:Date.now,send:async(payload)=>{unknownAttempt=payload.tags[0].value;throw Error('simulated transport lost');}});check(unknown==='unknown'&&Boolean(unknownAttempt),'real durable dispatch records transport ambiguity');
 const bytes=new Uint8Array(32).fill(29);const secret='whsec_'+btoa(String.fromCharCode(...bytes));
 const webhook=createTicketEmailWebhookHandler({readEnv:()=>secret,rpc:service,verify:verifyProviderObservation});
 const unknownProvider='local-unknown-'+crypto.randomUUID();
 async function observation(kind:string,id:string,attempt=unknownAttempt,provider=unknownProvider,tamper=false){
  const raw=JSON.stringify({type:`email.${kind}`,created_at:new Date().toISOString(),data:{email_id:provider,tags:{attempt_id:attempt}}});
  const timestamp=String(Math.floor(Date.now()/1000));const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${id}.${timestamp}.${raw}`));
  return webhook(new Request(f.edge,{method:'POST',headers:{'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+btoa(String.fromCharCode(...new Uint8Array(sig)))},body:raw+(tamper?' ':'')}));
 }
 check((await observation('delivered',crypto.randomUUID(),unknownAttempt,unknownProvider,true)).status===400,'invalid signature rejected before ledger routing');
 check((await observation('delivered',crypto.randomUUID())).status===200,'signed webhook resolves organizer unknown in real database');
 check((await observation('delivered',crypto.randomUUID(),unknownAttempt,'wrong-provider')).status===400,'provider ID binding rejects mismatch');
 check((await observation('complained',crypto.randomUUID())).status===200,'signed complaint writes shared suppression provenance');
 const suppressed=await action(f.paid,{action:'preview',selector:{kind:'everyone'},subject,body});check(suppressed.body.preview?.recipientCount===0,'complaint suppresses future organizer audience');
 check((await observation('delivered',crypto.randomUUID(),crypto.randomUUID())).status===400,'unknown attempt UUID rejected');
 console.log(`${passed} local API/worker/signed-webhook assertions passed. Provider transport was injected; network allowed only local Supabase.`);
 Deno.exit(0);
}
