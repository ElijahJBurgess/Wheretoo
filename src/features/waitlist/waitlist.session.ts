const key='wheretoo:waitlist-leave:v1'
const pattern=/^wl1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
let memory:{token:string;expiresAt:number}|null=null
export function captureWaitlistLeave(){
 if(typeof window==='undefined'||location.pathname!=='/waitlist/leave'||!location.hash)return
 const token=location.hash.slice(1);history.replaceState(history.state,'',location.pathname)
 memory=pattern.test(token)?{token,expiresAt:Date.now()+86400000}:null
 try{if(memory)sessionStorage.setItem(key,JSON.stringify(memory));else sessionStorage.removeItem(key)}catch{/* Tab memory remains usable. */}
}
export function readWaitlistLeave():string|null{
 let value=memory
 try{const raw=sessionStorage.getItem(key);if(raw)value=JSON.parse(raw) as typeof memory}catch{/* Invalid or blocked storage falls back to memory. */}
 return value&&pattern.test(value.token)&&value.expiresAt>Date.now()&&value.expiresAt<=Date.now()+86400000?value.token:null
}
export function clearWaitlistLeave(){memory=null;try{sessionStorage.removeItem(key)}catch{/* Memory already cleared. */}}
export async function joinRequestKey(value:{eventId:string;tierId:string;name:string;email:string}){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))
 return 'wheretoo:waitlist-request:'+Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('')
}
