import { Section, Text } from '@react-email/components'
import type { EventStateEmailProps } from './email.types'
import { EmailFrame } from './EmailFrame'
import { emailStyles } from './emailStyles'

export function EventCancelledEmail(props: EventStateEmailProps) {
  return (
    <EmailFrame
      eyebrow="Event cancelled"
      preview={`${props.eventName} has been cancelled`}
      recipientLabel={props.recipientLabel}
      title={`${props.eventName} has been cancelled`}
      viewTicketsUrl={props.viewStatusUrl ?? props.viewTicketsUrl}
      actionLabel={props.viewStatusUrl ? "View event status" : undefined}
      privacyLabel={props.viewStatusUrl ? "This private link opens your event and order status. It cannot be used for entry." : undefined}
      supportEmail={props.supportEmail}
    >
      <Text style={emailStyles.text}>This event is no longer going ahead.</Text>
      <Section style={emailStyles.facts}>
        <Text style={emailStyles.fact}><strong>Last published schedule</strong><br />{props.startsAtLabel}</Text>
        <Text style={emailStyles.fact}><strong>Venue</strong><br />{props.venueName}</Text>
      </Section>
      <Text style={emailStyles.text}>Unused admissions cannot be used for entry. Prior check-ins remain recorded.</Text>
      {props.financialStatusLabel ? <Text style={emailStyles.text}>{props.financialStatusLabel}</Text> : null}
      {props.expiresAtLabel ? <Text style={emailStyles.privacy}>This private status link expires {props.expiresAtLabel}.</Text> : null}
    </EmailFrame>
  )
}
