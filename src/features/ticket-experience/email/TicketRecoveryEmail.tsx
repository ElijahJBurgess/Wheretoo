import { Text } from '@react-email/components'
import { EmailFrame } from './EmailFrame'
import { emailStyles } from './emailStyles'
import type { TicketRecoveryProps } from './email.types'

export function TicketRecoveryEmail(props: TicketRecoveryProps) {
  return (
    <EmailFrame
      eyebrow="Ticket access"
      preview={props.overflow ? 'Help with your ticket access' : 'Your existing tickets'}
      title={props.overflow ? 'Let’s help you find your tickets' : 'Your tickets, together'}
      recipientLabel={props.recipientLabel}
      supportEmail={props.supportEmail}
      actionLabel="View my tickets"
      viewTicketsUrl={props.overflow ? undefined : props.viewTicketsUrl}
    >
      {props.overflow ? (
        <Text style={emailStyles.text}>Please reply to this email so our support team can help you recover access to your existing tickets.</Text>
      ) : (
        <>
          <Text style={emailStyles.text}>You have {props.ticketCount} existing {props.ticketCount === 1 ? 'ticket' : 'tickets'} in {props.collectionCount} separate {props.collectionCount === 1 ? 'collection' : 'collections'}. Open each collection to view its tickets and current status.</Text>
          <Text style={emailStyles.text}>This private link is available for 24 hours from when it was prepared. Opening a collection does not extend that time. Used tickets remain as history.</Text>
        </>
      )}
    </EmailFrame>
  )
}
