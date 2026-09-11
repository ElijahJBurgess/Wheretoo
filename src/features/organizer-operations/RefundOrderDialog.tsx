import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getOrder, refundOrder } from './operations.api'
import { operationsKeys } from './operations.queries'
import { OperationsDialog } from './OperationsDialog'
import { money } from './operations.format'
export function RefundOrderDialog(
  { ownerId, eventId, orderId, orderNumber, totalMinor, quantity, onClose }: {
    ownerId: string
    eventId: string
    orderId: string
    orderNumber: string
    totalMinor: number
    quantity: number
    onClose(): void
  },
) {
  const client = useQueryClient()
  const mutation = useMutation({
    mutationKey: [...operationsKeys.event(ownerId, eventId), 'refund', orderId],
    gcTime: 0,
    mutationFn: () => refundOrder(eventId, orderId),
    retry: false,
    onSettled: () => client.invalidateQueries({ queryKey: operationsKeys.event(ownerId, eventId) }),
  })
  const canonical = useQuery({
    queryKey: [...operationsKeys.event(ownerId, eventId), 'order', orderId],
    queryFn: () => getOrder(eventId, orderId),
    enabled: mutation.isSuccess || mutation.isError,
    refetchInterval: (query) =>
      (mutation.isSuccess || mutation.isError) && query.state.data?.refundState !== 'refunded'
        ? 5000
        : false,
  })
  const confirmed = canonical.data?.status === 'refunded' &&
    canonical.data.refundState === 'refunded'
  return (
    <OperationsDialog title='Refund entire order?' busy={mutation.isPending} onClose={onClose}>
      <p>Order #{orderNumber}</p>
      <p>
        Refund <strong>{money(totalMinor)}</strong> for all <strong>{quantity} tickets</strong>.
      </p>
      <p className='ops-note'>
        Unused tickets will no longer admit guests. Previous check-ins stay in the event history.
      </p>
      {mutation.isError && !confirmed && (
        <p role='alert'>Refund not confirmed. Refresh the order status or retry safely.</p>
      )}
      {(mutation.isSuccess || confirmed) && (
        <p role='status'>
          {confirmed ? 'Refund confirmed' : 'Refund pending. Waiting for payment confirmation.'}
        </p>
      )}
      {canonical.isError && mutation.isSuccess && (
        <p role='alert'>Order status could not refresh. Completion is unconfirmed.</p>
      )}
      <div className='ops-actions'>
        <button className='ops-button' disabled={mutation.isPending} onClick={onClose}>
          {mutation.isSuccess || confirmed ? 'Done' : 'Cancel'}
        </button>
        {!mutation.isSuccess && !confirmed && (
          <button
            className='ops-button ops-button--danger'
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Requesting refund…' : 'Refund entire order'}
          </button>
        )}
        {(mutation.isSuccess || mutation.isError) && !confirmed && (
          <button
            className='ops-button'
            disabled={canonical.isFetching}
            onClick={() => void canonical.refetch()}
          >
            Refresh status
          </button>
        )}
      </div>
    </OperationsDialog>
  )
}
