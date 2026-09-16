import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { BuyerHeader } from '../buyer-journey/BuyerPrimitives'
import { useTicketDocumentPrivacy } from '../ticket-experience/customer/useTicketDocumentPrivacy'
import { publicTicketDeliveryApi } from './delivery.public-api'
import { emailSchema, uuid } from './delivery.schemas'
import { DeliverySupport } from './DeliverySupport'
import './ticket-delivery.css'
const key = 'wheretoo:ticket-recovery:v1'
const savedSchema = z.strictObject({ email: emailSchema, requestId: uuid, expiresAt: z.number().finite() })
function load() {
  try { const result = savedSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? 'null')); return result.success && result.data.expiresAt > Date.now() ? result.data : null } catch { return null }
}
export function TicketRecoveryPage() {
  useTicketDocumentPrivacy()
  const [saved, setSaved] = useState(load)
  const [email, setEmail] = useState(saved?.email ?? '')
  const [state, setState] = useState<'idle' | 'sending' | 'requested' | 'error'>(saved ? 'error' : 'idle')
  const [invalid, setInvalid] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const latch = useRef(false)
  useEffect(() => () => controller.current?.abort(), [])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (latch.current) return
    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) { setInvalid(true); return }
    setInvalid(false)
    const operation = saved?.email === parsed.data ? saved : { email: parsed.data, requestId: crypto.randomUUID(), expiresAt: Date.now() + 24 * 60 * 60 * 1000 }
    try { sessionStorage.setItem(key, JSON.stringify(operation)) } catch { setState('error'); return }
    setSaved(operation); setEmail(operation.email); setState('sending'); latch.current = true
    const abort = new AbortController(); controller.current = abort
    try { await publicTicketDeliveryApi.recover(operation.email, operation.requestId, abort.signal); if (!abort.signal.aborted) setState('requested') }
    catch { if (!abort.signal.aborted) setState('error') }
    finally { latch.current = false }
  }
  function differentEmail() {
    controller.current?.abort()
    try { sessionStorage.removeItem(key) } catch { /* The next request must successfully save before sending. */ }
    setSaved(null); setEmail(''); setState('idle'); setInvalid(false)
  }
  return <main className='buyer-page delivery-recovery'>
    <BuyerHeader />
    <div className='buyer-content'>
      <span className='delivery-eyebrow'>Your tickets. Still yours.</span>
      <h1>{state === 'requested' ? 'Check your email' : <>Find your<br />tickets</>}</h1>
      {state === 'requested' ? <>
        <p role='status'>If eligible tickets match that email, we’ll send a secure link to access them. Check your inbox and spam folder.</p>
        <button className='ui-button buyer-secondary' onClick={differentEmail}>Use a different email</button>
      </> : <>
        <p>Enter the email you used to buy tickets or RSVP. We’ll help you access your existing tickets.</p>
        <form onSubmit={event => void submit(event)} className='delivery-form' noValidate>
          <label htmlFor='recovery-email'>Email address</label>
          <input id='recovery-email' type='email' autoComplete='email' inputMode='email' maxLength={320} value={email} readOnly={!!saved} disabled={state === 'sending'} onChange={event => setEmail(event.target.value)} aria-invalid={invalid} aria-describedby={invalid ? 'recovery-error' : undefined} />
          {invalid && <p id='recovery-error' role='alert'>Enter a valid email address.</p>}
          {state === 'error' && <p role='alert'>The request is not confirmed. Check your connection and try again.</p>}
          <button className='ui-button buyer-primary' disabled={state === 'sending'}>{state === 'sending' ? 'Requesting link…' : state === 'error' ? 'Try again' : 'Send me my tickets'}</button>
          {saved && <button type='button' className='ui-button buyer-secondary' disabled={state === 'sending'} onClick={differentEmail}>Use a different email</button>}
        </form>
      </>}
      <DeliverySupport />
      <p className='delivery-privacy'>No account needed. A secure email link opens only the tickets included with that link.</p>
    </div>
  </main>
}
