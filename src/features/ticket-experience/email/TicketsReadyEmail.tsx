import { Section, Text } from '@react-email/components'
import type { TicketsReadyProps } from './email.types'
import { EmailFrame } from './EmailFrame'
import { emailStyles } from './emailStyles'

const admissionStyle = {
  margin: '0 0 10px',
  border: '1px dashed #dedce8',
  borderRadius: '12px',
  padding: '14px 16px',
  backgroundColor: '#f7f7fb',
}

const admissionPositionStyle = {
  margin: '0 0 4px',
  color: '#6f6a7d',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '0.6px',
  textTransform: 'uppercase' as const,
}

const admissionLabelStyle = {
  margin: '0',
  color: '#19162c',
  fontSize: '16px',
  fontWeight: '700',
}

export function TicketsReadyEmail(props: TicketsReadyProps) {
  return (
    <EmailFrame
      eyebrow="Tickets ready"
      preview={`${props.eventName} tickets are ready`}
      recipientLabel={props.recipientLabel}
      title={`${props.eventName} tickets are ready`}
      viewTicketsUrl={props.viewTicketsUrl}
    >
      <Text style={emailStyles.text}>Your admission collection is ready. Open one ticket at a time when you arrive.</Text>
      <Section style={emailStyles.facts}>
        <Text style={emailStyles.fact}><strong>When</strong><br />{props.startsAtLabel}</Text>
        <Text style={emailStyles.fact}><strong>Where</strong><br />{props.venueName}</Text>
      </Section>
      <Section>
        {props.admissions.map((admission) => (
          <Section key={admission.positionLabel} style={admissionStyle}>
            <Text style={admissionPositionStyle}>{admission.positionLabel}</Text>
            <Text style={admissionLabelStyle}>{admission.admissionLabel}</Text>
          </Section>
        ))}
      </Section>
    </EmailFrame>
  )
}
