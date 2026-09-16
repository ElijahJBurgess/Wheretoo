import type { DeliveryAttempt, PublicDeliveryStatus, TicketDelivery } from './delivery.schemas'
export function deliveryCopy(value: Pick<DeliveryAttempt, 'state' | 'observation'> | PublicDeliveryStatus) {
  const observation = value.observation
  if (observation === 'bounced') return { title: 'Email bounced', message: 'The email provider reported that this address could not receive the message.' }
  if (observation === 'complained') return { title: 'Email reported as spam', message: 'Further ticket emails to this address are blocked.' }
  if (observation === 'failed') return { title: 'Email delivery failed', message: 'The email provider reported a delivery failure.' }
  if (observation === 'delivered') return { title: 'Email delivery reported', message: 'The email provider reported delivery. Check the inbox and spam folder.' }
  if (observation === 'delivery_delayed') return { title: 'Email delivery delayed', message: 'The email provider is still trying to deliver the message.' }
  const copy = {
    queued: { title: 'Ticket email queued', message: 'The email is waiting to be sent. Your existing tickets are unchanged.' },
    sending: { title: 'Sending tickets…', message: 'The email request is being processed. You can check its status here.' },
    accepted: { title: 'Email accepted', message: 'The email provider accepted the ticket email. Check the inbox and spam folder; acceptance does not confirm inbox arrival.' },
    failed: { title: 'Couldn’t resend tickets', message: 'The send failed. You can request another email after the cooldown.' },
    unknown: { title: 'Send status unknown', message: 'The send may have completed. Check status before requesting another email.' },
    suppressed: { title: 'Ticket email not sent', message: 'This email was stopped. Check the current ticket status.' },
    not_requested: { title: 'Ticket email not requested', message: 'Keep this private link to access your tickets.' },
  }
  return copy[value.state]
}
export function ineligibleCopy(reason: TicketDelivery['reason']) {
  switch (reason) {
    case 'recipient_blocked': return 'A verified bounce or spam report blocks further emails to this address.'
    case 'ended': return 'This event has ended. Existing ticket history is preserved.'
    case 'no_valid_tickets': return 'There are no unused valid admissions to resend. Existing check-in history is preserved.'
    case 'financially_unresolved': return 'Payment or refund status must be resolved before another ticket email can be sent.'
    case 'inactive': return 'This source or event is no longer active. Refunded and cancelled tickets cannot be resent.'
    case 'invalid_recipient': return 'The recorded email address cannot receive ticket emails.'
    default: return 'Ticket email eligibility could not be confirmed.'
  }
}
