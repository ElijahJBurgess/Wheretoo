import { useId,useRef,useState } from 'react'
import { joinWaitlist,type JoinIntent } from './waitlist.api'
import { joinRequestKey } from './waitlist.session'
import './waitlist.css'
export function WaitlistJoinForm({eventId,tierId,tierName,onAvailable,onCancel}:{eventId:string;tierId:string;tierName:string;onAvailable:()=>void|Promise<void>;onCancel:()=>void}){
 const id=useId();const [name,setName]=useState('');const [email,setEmail]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [success,setSuccess]=useState(false);const [unresolved,setUnresolved]=useState(false)
 const intent=useRef<JoinIntent|null>(null);const requestKey=useRef('')
 async function submit(event:React.SubmitEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;setBusy(true);setMessage('')
  try{
   if(!intent.current){const fields={eventId,tierId,name:name.trim(),email:email.trim().toLowerCase()};requestKey.current=await joinRequestKey(fields);let requestId:string|null=null;try{requestId=sessionStorage.getItem(requestKey.current)}catch{/* Memory protects retries in this view. */}if(!requestId||!/^[a-f0-9-]{36}$/i.test(requestId))requestId=crypto.randomUUID();intent.current={...fields,requestId};try{sessionStorage.setItem(requestKey.current,requestId)}catch{/* Memory fallback. */}}
   const result=await joinWaitlist(intent.current)
   setUnresolved(false)
   if(result.kind==='joined'){setSuccess(true);try{sessionStorage.removeItem(requestKey.current)}catch{/* Safe to retain receipt. */}}
   else if(result.kind==='TICKETS_AVAILABLE'){intent.current=null;await onAvailable()}
   else{intent.current=null;setMessage(result.kind==='RATE_LIMITED'?'Too many attempts. Please try again later.':result.kind==='INVALID_INPUT'?'Check your name and email, then try again.':'Waitlist is unavailable right now. Please try again.')}
  }catch{setUnresolved(true);setMessage('We could not confirm your request. Try again to check the same request.')}
  finally{setBusy(false)}
 }
 if(success)return <p className='waitlist-feedback' role='status'>You’re on the waitlist. We’ll email you if {tierName} tickets become available.</p>
 return <form className='waitlist-form' onSubmit={submit}>
 <p>Join the {tierName} waitlist. Tickets are not reserved.</p>
 <label htmlFor={id+'-name'}>Name</label><input autoComplete='name' autoFocus disabled={busy||unresolved} id={id+'-name'} maxLength={120} required value={name} onChange={e=>setName(e.target.value)}/>
 <label htmlFor={id+'-email'}>Email</label><input autoComplete='email' disabled={busy||unresolved} id={id+'-email'} type='email' maxLength={320} required value={email} onChange={e=>setEmail(e.target.value)}/>
 {message&&<p role='alert'>{message}</p>}<div className='waitlist-actions'><button className='ui-button ui-button--primary' disabled={busy} type='submit'>{busy?'Joining…':unresolved?'Try again':'Join Waitlist'}</button><button className='ui-button ui-button--secondary' disabled={busy} type='button' onClick={onCancel}>Cancel</button></div>
 </form>
}
