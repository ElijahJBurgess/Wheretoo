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
      viewTicketsUrl={props.viewTicketsUrl}
    >
      <Text style={emailStyles.text}>This event is no longer going ahead.</Text>
      <Section style={emailStyles.facts}>
        <Text style={emailStyles.fact}><strong>Originally scheduled</strong><br />{props.startsAtLabel}</Text>
        <Text style={emailStyles.fact}><strong>Venue</strong><br />{props.venueName}</Text>
      </Section>
    </EmailFrame>
  )
}
