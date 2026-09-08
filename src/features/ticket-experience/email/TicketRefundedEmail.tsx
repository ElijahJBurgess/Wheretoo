import { Section, Text } from '@react-email/components'
import type { TicketStateEmailProps } from './email.types'
import { EmailFrame } from './EmailFrame'
import { emailStyles } from './emailStyles'

export function TicketRefundedEmail(props: TicketStateEmailProps) {
  return (
    <EmailFrame
      eyebrow="Ticket refunded"
      preview={`Your ${props.eventName} ticket was refunded`}
      recipientLabel={props.recipientLabel}
      title={`Your ${props.eventName} ticket was refunded`}
      viewTicketsUrl={props.viewTicketsUrl}
    >
      <Text style={emailStyles.text}>{props.admissionLabel} ({props.positionLabel}) has been refunded.</Text>
      <Section style={emailStyles.facts}>
        <Text style={emailStyles.fact}><strong>Event</strong><br />{props.eventName}</Text>
        <Text style={emailStyles.fact}><strong>When</strong><br />{props.startsAtLabel}</Text>
        <Text style={emailStyles.fact}><strong>Venue</strong><br />{props.venueName}</Text>
      </Section>
    </EmailFrame>
  )
}
