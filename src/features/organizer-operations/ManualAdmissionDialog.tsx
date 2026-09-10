import { useMutation, useQueryClient } from '@tanstack/react-query'
import { redeemTicket } from './operations.api'
import { operationsKeys } from './operations.queries'
import type { OrderDetail } from './operations.schemas'
import { OperationsDialog } from './OperationsDialog'
import { dateTime } from './operations.format'
export function ManualAdmissionDialog({
  ownerId,
  eventId,
  buyerName,
  eventName,
  ticketNumber,
  ticket,
  onClose,
}: {
  ownerId: string
  eventId: string
  buyerName: string
  eventName: string
  ticketNumber: number
  ticket: OrderDetail['tickets'][number]
  onClose(): void
}) {
  const client = useQueryClient()
  const mutation = useMutation({
    mutationKey: [...operationsKeys.event(ownerId, eventId), 'admit'],
    gcTime: 0,
    mutationFn: () => redeemTicket(eventId, ticket.id),
    retry: false,
    onSettled: () => client.invalidateQueries({ queryKey: operationsKeys.event(ownerId, eventId) }),
  })
  const result = mutation.data
  const titles = {
    admitted: 'Admitted',
    already_used: 'Already used',
    refunded: 'Ticket refunded',
    cancelled: 'Ticket cancelled',
    invalid: 'Admission denied',
    wrong_event: 'Wrong event',
  }
  return (
    <OperationsDialog title='Confirm check-in' busy={mutation.isPending} onClose={onClose}>
      <p>{eventName}</p>
      <p>{buyerName}</p>
      <p>Ticket {ticketNumber} · {ticket.id.slice(-8)}</p>
      <p>{ticket.admissionLabel}</p>
      <p className='ops-note'>Admit this individual ticket to the selected event?</p>
      {mutation.isError && (
        <p role='alert'>Admission not confirmed. Check the ticket status before retrying.</p>
      )}
      {result && (
        <div role={result.outcome === 'admitted' ? 'status' : 'alert'}>
          <h3>{titles[result.outcome]}</h3>
          {'usedAt' in result && <p>Checked in · {dateTime(result.usedAt)}</p>}
        </div>
      )}
      <div className='ops-actions'>
        <button className='ops-button' disabled={mutation.isPending} onClick={onClose}>
          {result ? 'Done' : 'Cancel'}
        </button>
        {!result && (
          <button
            className='ops-button ops-button--primary'
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Checking…' : 'Admit guest'}
          </button>
        )}
      </div>
    </OperationsDialog>
  )
}
