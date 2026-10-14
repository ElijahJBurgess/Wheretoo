import { Button } from '../../components/ui/Button'
import { AsyncState } from '../../components/ui/AsyncState'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { clearCheckoutAttemptForConfirmation } from '../checkout/checkout.attempt'
import type { OrderConfirmation } from './order.types'
import { BuyerHeader } from '../buyer-journey/BuyerPrimitives'
import { OrderConfirmationView } from '../buyer-journey/OrderConfirmationView'
import { useOrderConfirmation } from './order.queries'

type ConfirmationStatus = OrderConfirmation['status']

const terminalStatuses = new Set<ConfirmationStatus>([
  'paid',
  'payment_failed',
  'cancelled',
  'expired',
  'refunded',
])

function StandaloneState({
  action,
  description,
  status,
  title,
}: {
  action?: React.ReactNode
  description: string
  status: 'loading' | 'error'
  title: string
}) {
  return (
    <main className="buyer-page buyer-state">
      <BuyerHeader />
      <h1 className="confirmation-state__title">{title}</h1>
      <AsyncState action={action} description={description} status={status} title="Order status" />
    </main>
  )
}

function OrderConfirmationRoute({ confirmationToken }: { confirmationToken: string }) {
  const confirmation = useOrderConfirmation(confirmationToken)
  const status = confirmation.data?.status

  useEffect(() => {
    if (status !== undefined && terminalStatuses.has(status)) {
      clearCheckoutAttemptForConfirmation(confirmationToken)
    }
  }, [confirmationToken, status])

  if (confirmation.isPending) {
    return <StandaloneState description="Checking the latest persisted order status." status="loading" title="Loading order" />
  }
  if (confirmation.isError) {
    return (
      <StandaloneState
        action={<Button onClick={() => void confirmation.retry()} type="button">Try again</Button>}
        description="Check your connection, then try again."
        status="error"
        title="Order could not load"
      />
    )
  }
  if (confirmation.data === null || confirmation.data === undefined) {
    return <StandaloneState description="This confirmation link is invalid or unavailable." status="error" title="Order not found" />
  }

  return <OrderConfirmationView
    order={confirmation.data}
    isTimedOut={confirmation.isTimedOut}
    ticketAction={<Link className="ui-button buyer-primary" reloadDocument to={`/tickets/${encodeURIComponent(confirmationToken)}`}>View tickets</Link>}
    retryAction={<Button onClick={() => void confirmation.retry()} type="button">Check again</Button>}
  />
}

export function OrderConfirmationPage() {
  const { confirmationToken = '' } = useParams()
  return <OrderConfirmationRoute confirmationToken={confirmationToken} key={confirmationToken} />
}
