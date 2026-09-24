import { useEffect,useState } from 'react'
import { leaveWaitlist } from './waitlist.api'
import { captureWaitlistLeave,clearWaitlistLeave,readWaitlistLeave } from './waitlist.session'
import './waitlist.css'
export function WaitlistLeavePage(){
 const [token,setToken]=useState(readWaitlistLeave);const [state,setState]=useState<'ready'|'busy'|'done'|'error'|'invalid'>(token?'ready':'invalid')
 useEffect(()=>{const capture=()=>{captureWaitlistLeave();const next=readWaitlistLeave();setToken(next);setState(next?'ready':'invalid')};window.addEventListener('hashchange',capture);return()=>window.removeEventListener('hashchange',capture)},[])
 async function leave(){if(!token)return;setState('busy');try{const r=await leaveWaitlist(token);if(readWaitlistLeave()!==token)return;if(r.kind==='removed'){setState('done');clearWaitlistLeave()}else setState(r.kind==='unavailable'?'invalid':'error')}catch{if(readWaitlistLeave()===token)setState('error')}}
 return <main className='buyer-page waitlist-leave'><h1>Leave Waitlist</h1>{state==='done'?<p role='status'>You’ve been removed from this waitlist.</p>:state==='invalid'?<p role='alert'>This waitlist link is unavailable or expired.</p>:<><p>This removes your enrollment from this waitlist. Any tickets you purchased are unchanged.</p>{state==='error'&&<p role='alert'>We could not confirm removal. Please try again.</p>}<button className='ui-button ui-button--primary' disabled={state==='busy'} onClick={()=>void leave()}>{state==='busy'?'Removing…':'Leave Waitlist'}</button></>}</main>
}
