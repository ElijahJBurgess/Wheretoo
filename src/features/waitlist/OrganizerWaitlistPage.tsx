import { useEffect,useRef,useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link,useParams } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { getOwnedWaitlist,removeOwnedWaitlist,type WaitlistCursor } from './waitlist.api'
import './waitlist.css'
export function OrganizerWaitlistPage(){const {eventId=''}=useParams();const session=useSession();const owner=session.status==='authenticated'?session.user.id:'';return <OwnedList key={owner+eventId} eventId={eventId} owner={owner}/>}
function OwnedList({eventId,owner}:{eventId:string;owner:string}){
 const [tier,setTier]=useState<string|null>(null);const [cursor,setCursor]=useState<WaitlistCursor|null>(null);const [remove,setRemove]=useState<string|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const dialog=useRef<HTMLDialogElement>(null)
 const query=useQuery({queryKey:['waitlist',owner,eventId,tier,cursor],queryFn:()=>getOwnedWaitlist(eventId,tier,cursor),enabled:!!owner&&!!eventId,retry:false,staleTime:0})
 useEffect(()=>{if(remove)dialog.current?.showModal();else dialog.current?.close()},[remove])
 async function confirm(){if(!remove||!tier)return;setBusy(true);setError('');try{await removeOwnedWaitlist(eventId,tier,remove);setRemove(null);await query.refetch()}catch{setError('Could not remove this enrollment. Try again.')}finally{setBusy(false)}}
 return <section className='waitlist-owner' aria-label='Event waitlist'><Link to={`/organizer/events/${eventId}`}>Back to event</Link><h1>Waitlist</h1><p>Demand by ticket tier. Tickets are first come, first served; joining reserves nothing.</p>
 {query.isPending?<p role='status'>Loading waitlist…</p>:query.isError?<div role='alert'>Waitlist unavailable.<button onClick={()=>void query.refetch()}>Try again</button></div>:<>
 {query.data.closed&&<p role='status'>This waitlist is closed. No further notifications will be sent.</p>}
 <div className='waitlist-tiers'>{query.data.tiers.map(t=><button aria-pressed={tier===t.id} key={t.id} onClick={()=>{setTier(t.id);setCursor(null)}}><strong>{t.name}</strong><span>{t.waiting} waiting{t.closed?' · Closed':''}</span></button>)}</div>
 {query.data.tiers.length===0&&<p>No paid ticket tiers.</p>}{tier?<><p>Notified means the email provider accepted a restock notification. It does not prove inbox delivery.</p>
 {query.data.entries.length===0?<p>No waitlist enrollments.</p>:<div className='waitlist-table-wrap'><table><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Status</th><th>Action</th></tr></thead><tbody>{query.data.entries.map(w=><tr key={w.id}><td>{w.name}</td><td>{w.email}</td><td>{new Date(w.joinedAt).toLocaleString()}</td><td>{w.status}{w.closed?' · Closed':''}</td><td>{['Waiting','Notified'].includes(w.status)&&!query.data.closed&&!w.closed&&<button onClick={()=>setRemove(w.id)}>Remove from waitlist</button>}</td></tr>)}</tbody></table></div>}
 <div className='waitlist-actions'>{cursor&&<button onClick={()=>setCursor(null)}>Newest</button>}{query.data.nextCursor&&<button onClick={()=>setCursor(query.data.nextCursor)}>Older enrollments</button>}</div></>:<p>Select a tier to view its waitlist.</p>}</>}
 <dialog ref={dialog} aria-labelledby='waitlist-remove-title' onCancel={event=>{if(busy)event.preventDefault();else setRemove(null)}}><h2 id='waitlist-remove-title'>Remove from waitlist?</h2><p>This enrollment will stop receiving restock notifications.</p>{error&&<p role='alert'>{error}</p>}<div className='waitlist-actions'><button disabled={busy} onClick={()=>setRemove(null)}>Cancel</button><button disabled={busy} onClick={()=>void confirm()}>{busy?'Removing…':'Remove'}</button></div></dialog>
 </section>
}
