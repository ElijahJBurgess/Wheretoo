import { z } from 'zod'
import { supabase } from '../../lib/supabase/client'
import type { Json } from '../../lib/supabase/database.types'
export type JoinIntent={eventId:string;tierId:string;name:string;email:string;requestId:string}
const joinResult=z.object({kind:z.enum(['joined','TICKETS_AVAILABLE','WAITLIST_UNAVAILABLE','INVALID_INPUT','RATE_LIMITED'])}).strict()
async function invoke(name:string,body:Record<string,unknown>):Promise<unknown>{
 const {data,error}=await supabase.functions.invoke(name,{body})
 if(error){if(error.context instanceof Response){try{return await error.context.json()}catch{throw Error('Request unavailable')}}throw Error('Request unavailable')}
 return data
}
export async function joinWaitlist(body:JoinIntent){return joinResult.parse(await invoke('waitlist-join',body))}
export async function leaveWaitlist(token:string){return z.object({kind:z.enum(['removed','unavailable','rate_limited'])}).strict().parse(await invoke('waitlist-leave',{token}))}
export async function getWaitlistCapability(eventId:string){
 const {data,error}=await supabase.rpc('get_public_waitlist_capability',{p_event_id:eventId});if(error)throw Error('Waitlist unavailable')
 return z.object({enabled:z.boolean(),eligible:z.boolean()}).strict().parse(data)
}
export type WaitlistCursor={id:string;joinedAt:string;tierId:string}
const ownerSchema=z.object({tiers:z.array(z.object({id:z.uuid(),name:z.string(),waiting:z.number().int().nonnegative(),closed:z.boolean()})),entries:z.array(z.object({id:z.uuid(),name:z.string(),email:z.string(),joinedAt:z.string(),closed:z.boolean(),status:z.enum(['Waiting','Notified','Purchased','Removed'])})),nextCursor:z.object({id:z.uuid(),joinedAt:z.string(),tierId:z.uuid()}).nullable(),closed:z.boolean()})
export async function getOwnedWaitlist(eventId:string,tierId:string|null,cursor:WaitlistCursor|null){
 const {data,error}=await supabase.rpc('get_owned_waitlist',{p_event_id:eventId,p_tier_id:tierId??undefined,p_cursor:cursor as Json});if(error)throw Error('Waitlist unavailable')
 return ownerSchema.parse(data)
}
export async function removeOwnedWaitlist(eventId:string,tierId:string,enrollmentId:string){
 const {data,error}=await supabase.rpc('remove_owned_waitlist',{p_event_id:eventId,p_tier_id:tierId,p_enrollment_id:enrollmentId});if(error||data!==true)throw Error('Removal unavailable')
}
