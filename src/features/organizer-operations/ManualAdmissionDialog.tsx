import type { ReactNode } from 'react'
import { AdmissionResultView } from '../ticket-experience/scanner/OrganizerScannerView'
import { useManualAdmission } from './useManualAdmission'
import { OperationsDialog } from './OperationsDialog'
import { dateTime } from './operations.format'
export function ManualAdmissionDialog({
  ownerId,
  identityVersion = 0,
  eventId,
  orderId,
  sourceKind = 'paid_order',
  orderNumber,
  timeZone,
  journey = false,
  resultActions,
  buyerName,
  eventName,
  ticketNumber,
  ticket,
  canAdmit = true,
  onClose,
}: {
  ownerId: string
  identityVersion?: number
  eventId: string
  orderId: string
  sourceKind?: 'paid_order' | 'free_registration'
  orderNumber?: string
  timeZone?: string
  journey?: boolean
  resultActions?: ReactNode
  buyerName: string
  eventName: string
  ticketNumber: number
  ticket: { id: string; admissionLabel: string; status: 'valid' | 'used' | 'refunded' | 'cancelled'; usedAt: string | null; issuedAt?: string }
  canAdmit?: boolean
  onClose(): void
}) {
  const mutation = useManualAdmission(ownerId, identityVersion, {
    sourceKind,
    sourceId: orderId,
    eventId,
    ticketId: ticket.id,
  })
  const result = mutation.result
  const titles = {
    admitted: 'Admitted',
    already_used: 'Already used',
    refunded: 'Ticket refunded',
    cancelled: 'Ticket cancelled',
    invalid: 'Admission denied',
    wrong_event: 'Wrong event',
  }
  if (journey && result) {
    return (
      <OperationsDialog
        className='ops-dialog--admission'
        title='Admission result'
        busy={false}
        onClose={onClose}
      >
        <AdmissionResultView
          source='manual'
          timeZone={timeZone}
          result={{
            outcome: result.outcome,
            ...('buyerName' in result
              ? { attendeeLabel: result.buyerName, admissionLabel: result.admissionLabel }
              : {}),
            ...('usedAt' in result ? { usedAt: result.usedAt } : {}),
          }}
        >
          {resultActions}
          <button className='ops-button' onClick={onClose}>Back to guest details</button>
        </AdmissionResultView>
      </OperationsDialog>
    )
  }
  if (journey && (mutation.phase === 'uncertain' || mutation.phase === 'rechecking')) {
    return (
      <OperationsDialog
        className='ops-dialog--admission'
        title='Admission not confirmed'
        busy={mutation.busy}
        onClose={onClose}
      >
        <AdmissionResultView
          source='manual'
          timeZone={timeZone}
          result={{ outcome: 'network_error' }}
        >
          <div className='find-guest__actions'>
            <button
              className='ops-button ops-button--primary'
              disabled={mutation.busy}
              onClick={mutation.recheck}
            >
              {mutation.busy ? 'Rechecking…' : 'Recheck ticket status'}
            </button>
            <button className='ops-button' disabled={mutation.busy} onClick={onClose}>
              Back to guest details
            </button>
          </div>
        </AdmissionResultView>
      </OperationsDialog>
    )
  }
  return (
    <OperationsDialog
      className='ops-dialog--admission'
      title='Confirm check-in'
      busy={mutation.busy}
      onClose={onClose}
    >
      <p>{eventName}</p>
      {orderNumber && <p>Order #{orderNumber}</p>}
      <p>{buyerName}</p>
      <p>Ticket {ticketNumber} · {ticket.id.slice(-8)}</p>
      <p>{ticket.admissionLabel}</p>
      <p className='ops-note'>Admit this individual ticket to the selected event?</p>
      {!canAdmit && !result && (
        <p role='status'>
          This ticket is no longer available for check-in.
        </p>
      )}
      {mutation.phase === 'uncertain' && (
        <p role='alert'>Admission not confirmed. Check the ticket status before retrying.</p>
      )}
      {result && (
        <div role={result.outcome === 'admitted' ? 'status' : 'alert'}>
          <h3>{titles[result.outcome]}</h3>
          {'usedAt' in result && <p>Checked in · {dateTime(result.usedAt, timeZone)}</p>}
        </div>
      )}
      <div className='ops-actions'>
        <button className='ops-button' disabled={mutation.busy} onClick={onClose}>
          {result ? 'Done' : 'Cancel'}
        </button>
        {mutation.phase === 'uncertain' && (
          <button className='ops-button ops-button--primary' onClick={mutation.recheck}>
            Recheck ticket status
          </button>
        )}
        {mutation.phase === 'closed' && !result && (
          <p role='alert'>Check-in unavailable. This ticket cannot currently be admitted.</p>
        )}
        {(mutation.phase === 'confirm' || mutation.phase === 'retry' ||
          mutation.phase === 'submitting') && (
          <button
            className='ops-button ops-button--primary'
            disabled={mutation.busy || !canAdmit}
            onClick={mutation.submit}
          >
            {mutation.busy ? 'Checking…' : 'Admit guest'}
          </button>
        )}
      </div>
    </OperationsDialog>
  )
}
