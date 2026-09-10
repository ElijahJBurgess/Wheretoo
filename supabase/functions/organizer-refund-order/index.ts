import { z } from "zod";
import { requireOrganizer } from "../_shared/auth.ts";
import type { OrganizerContext } from "../_shared/contracts.ts";
import { getCorsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/database.ts";
import { getAppBaseUrl } from "../_shared/env.ts";
import { HttpError } from "../_shared/http.ts";
import { refundOwnedOrder } from "./refundAdapter.ts";
const inputSchema=z.strictObject({eventId:z.uuid(),orderId:z.uuid()});
const contextSchema=z.strictObject({refundState:z.enum(['available','pending','refunded','unavailable'])});
export interface OrganizerRefundDependencies {
 appOrigin:string;
 verifyOrganizer(request:Request):Promise<OrganizerContext>;
 context(ownerId:string,eventId:string,orderId:string):Promise<unknown>;
 refund(orderId:string):Promise<void>;
}
async function readInput(request:Request) {
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json' || !request.body) throw new Error();
 const reader=request.body.getReader();let size=0;const chunks:number[]=[];
 try { while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256){await reader.cancel();throw new Error()}chunks.push(...value);} } finally {reader.releaseLock()}
 return inputSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(chunks))));
}
export function createOrganizerRefundHandler(deps:OrganizerRefundDependencies) {
 return async(request:Request):Promise<Response>=>{
  const headers=getCorsHeaders(request,deps.appOrigin);headers.set('content-type','application/json');headers.set('cache-control','private, no-store');headers.set('pragma','no-cache');
  const respond=(outcome:string,status=200)=>new Response(JSON.stringify({outcome}),{status,headers});
  if(!headers.has('access-control-allow-origin'))return respond('unconfirmed',403);
  const preflight=handleCorsPreflight(request,deps.appOrigin);if(preflight)return preflight;
  if(request.method!=='POST')return respond('unconfirmed',405);
  let owner:OrganizerContext;
  try{owner=await deps.verifyOrganizer(request)}catch(error){return respond('unconfirmed',error instanceof HttpError?error.status:503)}
  let input:z.infer<typeof inputSchema>;
  try{input=await readInput(request)}catch{return respond('unconfirmed',400)}
  const readState=async()=>contextSchema.parse(await deps.context(owner.organizerId,input.eventId,input.orderId)).refundState;
  try{
   const state=await readState();
   if(state==='pending'||state==='refunded')return respond(state);
   if(state!=='available')return respond('unconfirmed',409);
   try{await deps.refund(input.orderId)}catch{
    // An earlier request or webhook may have completed during this retry.
    const current=await readState();
    return current==='pending'||current==='refunded'?respond(current):respond('unconfirmed',503);
   }
   // Provider acknowledgement is not canonical refund completion.
   return respond('pending');
  }catch{return respond('unconfirmed',503)}
 };
}
export function handler(request:Request) {
 return createOrganizerRefundHandler({appOrigin:getAppBaseUrl(),verifyOrganizer:requireOrganizer,refund:refundOwnedOrder,
  async context(ownerId,eventId,orderId){const {data,error}=await getServiceClient().rpc('server_get_organizer_refund_context',{p_organizer_id:ownerId,p_event_id:eventId,p_order_id:orderId});if(error)throw new Error('Order unavailable');return data;}
 })(request);
}
if(import.meta.main)Deno.serve(handler);
