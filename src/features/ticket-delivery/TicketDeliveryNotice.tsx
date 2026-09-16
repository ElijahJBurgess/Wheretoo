import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { publicTicketDeliveryApi } from './delivery.public-api'
import type { PublicDeliveryStatus } from './delivery.schemas'
import { deliveryCopy } from './delivery.copy'
import './ticket-delivery.css'
export function TicketDeliveryNotice({ collectionBearer }: { collectionBearer: string }) {
  const [version, setVersion] = useState(0)
  const [loaded, setLoaded] = useState<{ bearer: string; version: number; status: PublicDeliveryStatus | null } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    publicTicketDeliveryApi.status(collectionBearer, controller.signal).then(
      status => { if (!controller.signal.aborted) setLoaded({ bearer: collectionBearer, version, status }) },
      () => { if (!controller.signal.aborted) setLoaded({ bearer: collectionBearer, version, status: null }) },
    )
    return () => controller.abort()
  }, [collectionBearer, version])
  const result = loaded?.bearer === collectionBearer && loaded.version === version ? loaded : null
  const copy = result?.status ? deliveryCopy(result.status) : result ? { title: 'Email status unavailable', message: 'Your tickets are still available from this private link.' } : { title: 'Checking ticket email…', message: 'You can open your tickets while we check the email status.' }
  return <aside className='delivery-notice' aria-label='Ticket email status'>
    <strong role='status'>{copy.title}</strong><p>{copy.message}</p>
    {result && <button type='button' onClick={() => setVersion(v => v + 1)}>Check email status</button>}
    <Link to='/tickets/recover'>Find your tickets</Link>
  </aside>
}
