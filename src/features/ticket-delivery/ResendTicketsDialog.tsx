import { OperationsDialog } from '../organizer-operations/OperationsDialog'
import { useTicketResend } from './delivery.queries'
import { deliveryCopy, ineligibleCopy } from './delivery.copy'
import { DeliverySupport } from './DeliverySupport'
import type { OwnedDeliverySource } from './delivery.schemas'
import './ticket-delivery.css'
type Props = OwnedDeliverySource & { onClose(): void }
export function ResendTicketsDialog(props: Props) {
  return <ResendContent key={[props.ownerId, props.eventId, props.sourceKind, props.sourceId].join(':')} {...props} />
}
function ResendContent({ onClose, ...source }: Props) {
  const model = useTicketResend(source)
  const { summary, status, ack, busy, requestId } = model
  const verified = summary.isFetchedAfterMount && !summary.isError ? summary.data : undefined
  const current = status.isFetchedAfterMount && !status.isError ? status.data : undefined
  const state = current ?? (busy ? { state: 'sending' as const, observation: null } : ack === 'queued' ? { state: 'queued' as const, observation: null } : requestId ? { state: 'unknown' as const, observation: null } : null)
  const copy = state ? deliveryCopy(state) : null
  const blocked = verified && (!verified.eligible || ack === 'ineligible')
  const disabled = verified && (!verified.configured || ack === 'not_enabled')
  const title = !summary.isFetchedAfterMount ? 'Checking ticket email…' : !verified ? 'Ticket email unavailable' : blocked ? 'Cannot resend tickets' : disabled ? 'Ticket email is not enabled' : copy?.title ?? 'Resend tickets?'
  return <OperationsDialog title={title} busy={false} onClose={onClose} className='delivery-dialog'>
    <span className={`delivery-seal ${state?.state === 'accepted' && !state.observation ? 'delivery-seal--accepted' : ''}`} aria-hidden='true'>✉</span>
    {!verified ? <p role='status'>{summary.isFetchedAfterMount ? 'Check your connection and organizer access, then try again.' : 'Checking the recorded recipient and current ticket status.'}</p> : <>
      <p>{blocked ? ineligibleCopy(verified.reason) : disabled ? 'Ticket email is not available for this event yet.' : copy?.message ?? 'This will resend access to the existing tickets to:'}</p>
      <p className='delivery-recipient'>{verified.recipientEmail}</p>
      <p className='delivery-explanation'>Resending access does not create new tickets or QR codes, change the order, or reset check-in history.</p>
      {ack === 'rate_limited' && <p role='alert'>Please wait before requesting another ticket email.</p>}
      {model.storageError && <p role='alert'>This browser cannot safely remember the resend request. Enable session storage before trying again.</p>}
      {status.isError && <p role='alert'>The latest send status could not be checked. The send may have completed.</p>}
    </>}
    <div className='delivery-dialog-actions'>
      {verified && !blocked && !disabled && !requestId && <button className='ops-button ops-button--primary' disabled={busy || ack === 'rate_limited'} onClick={() => void model.send()}>Confirm and resend</button>}
      {requestId && <button className='ops-button ops-button--primary' disabled={busy || status.isFetching} onClick={() => void status.refetch()}>Check status</button>}
      {verified && !blocked && !disabled && model.canRequestFresh && <button className='ops-button' disabled={busy} onClick={() => void model.send(true)}>Request another email</button>}
      {verified && !blocked && !disabled && requestId && status.isFetchedAfterMount && !status.isError && status.data === null && ack !== 'queued' && !busy && <button className='ops-button' onClick={() => void model.send()}>Retry same request</button>}
      {!verified && summary.isFetchedAfterMount && <button className='ops-button' onClick={() => void summary.refetch()}>Check again</button>}
      <button className='ops-button' onClick={onClose}>{requestId || blocked || disabled ? source.sourceKind === 'paid_order' ? 'Back to order' : 'Back to registration' : 'Cancel'}</button>
      <DeliverySupport />
    </div>
  </OperationsDialog>
}
