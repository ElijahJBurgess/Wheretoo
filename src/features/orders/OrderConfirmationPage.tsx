import { TicketDeliveryNotice } from '../ticket-delivery/TicketDeliveryNotice'
import { Button } from '../../components/ui/Button'
import { ReadState } from '../../components/ui/ReadState'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { clearCheckoutAttemptForConfirmation, getVerifiedCheckoutAssociation } from '../checkout/checkout.attempt'
import { cancelCheckoutAttempt } from '../checkout/checkout.recovery'
import { BuyerHeader } from '../buyer-journey/BuyerPrimitives'
import { BuyerRecoveryView } from '../buyer-journey/BuyerRecoveryView'
import { OrderConfirmationView } from '../buyer-journey/OrderConfirmationView'
import { useOrderConfirmation } from './order.queries'

function StandaloneState({
  action,
  paused,
  description,
  status,
  title,
}: {
  action?: React.ReactNode
  paused?: boolean
  description: string
  status: 'loading' | 'error'
  title: string
}) {
  if (status === 'error') return <BuyerRecoveryView announcementRole="alert" title={title} description={description} action={action} />
  return (
    <main className="buyer-page buyer-state">
      <BuyerHeader />
      <h1 className="confirmation-state__title">{title}</h1>
      <ReadState paused={paused} skeleton="detail-fields" action={action} description={description} status={status} title="Order status" />
    </main>
  )
}

function OrderConfirmationRoute({ confirmationToken }: { confirmationToken: string }) {
  const confirmation = useOrderConfirmation(confirmationToken)
  const status = confirmation.data?.status
  useEffect(() => {
    if (status === 'paid' || status === 'refunded') clearCheckoutAttemptForConfirmation(confirmationToken)
  }, [confirmationToken, status])

  const [association] = useState(() => getVerifiedCheckoutAssociation(confirmationToken))
  const [busy, setBusy] = useState(false)
  const [verified, setVerified] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const mounted = useRef(true)
  const lock = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function retry() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try { await confirmation.retry() }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  async function verifyReplacement() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setMessage(null)
    try {
      const result = await cancelCheckoutAttempt(confirmationToken)
      if (!mounted.current) return
      if (result.kind === 'cancelled') setVerified(true)
      else { setMessage('Unable to confirm that checkout has ended. Keep this order and check again.'); await confirmation.retry() }
    } finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  const retryAction = <Button disabled={busy} onClick={() => void retry()} type="button">{busy ? 'Checking status…' : 'Check again'}</Button>

  if (confirmation.isPending) {
    return <StandaloneState paused={confirmation.fetchStatus === 'paused'} description="Checking the latest persisted order status." status="loading" title="Loading order" />
  }
  if (confirmation.isError) {
    return (
      <StandaloneState
        action={<Button disabled={busy} onClick={() => void retry()} type="button">Try again</Button>}
        description="The payment result is unknown. Keep this order link and check again before starting another checkout."
        status="error"
        title="Unable to confirm payment"
      />
    )
  }
  if (confirmation.data === null || confirmation.data === undefined) {
    return <StandaloneState action={retryAction} description="The order could not be found. This does not confirm payment failed. Keep this link and check again." status="error" title="Unable to confirm payment" />
  }

  return <OrderConfirmationView
    order={confirmation.data}
    browseAction={confirmation.data.status !== 'processing' ? <Link className="ui-button buyer-secondary" to="/discover">Browse events</Link> : undefined}
    deliveryNotice={confirmation.data.status === 'paid' ? <TicketDeliveryNotice collectionBearer={confirmationToken} /> : undefined}
    isTimedOut={confirmation.isTimedOut}
    ticketAction={<Link className="ui-button buyer-primary" reloadDocument to={`/tickets/${encodeURIComponent(confirmationToken)}`}>View tickets</Link>}
    retryAction={retryAction}
    recoveryAction={association && status && ['payment_failed', 'cancelled', 'expired'].includes(status) ? <>
      {message ? <p role="status">{message}</p> : null}
      {verified ? <Link className="ui-button buyer-primary" to={association.selectionPath}>Choose tickets</Link> : <Button disabled={busy} onClick={() => void verifyReplacement()} type="button">{busy ? 'Verifying checkout…' : 'Verify before choosing tickets'}</Button>}
    </> : undefined}
  />
}

export function OrderConfirmationPage() {
  const { confirmationToken = '' } = useParams()
  return <OrderConfirmationRoute confirmationToken={confirmationToken} key={confirmationToken} />
}
