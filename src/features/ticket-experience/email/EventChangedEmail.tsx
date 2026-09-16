import { Section, Text } from '@react-email/components'
import type { EventChangedProps } from './email.types'
import { EmailFrame } from './EmailFrame'
import { emailStyles } from './emailStyles'
export function EventChangedEmail(props: EventChangedProps) {
 return <EmailFrame eyebrow="Event update" preview={`${props.eventName} has changed`} recipientLabel={props.recipientLabel} title="Your event has been updated" viewTicketsUrl={props.viewStatusUrl} actionLabel="View event update" privacyLabel="This private link opens your current event and ticket status. Keep it to yourself." supportEmail={props.supportEmail}>
  <Text style={emailStyles.text}>{props.eventName} has updated details. Please review them before attending.</Text>
  <Section style={emailStyles.facts}>{props.changes.map(change=><Text key={change.label} style={emailStyles.fact}><strong>{change.label}</strong><br />Previous: {change.previous}<br />New: {change.current}</Text>)}</Section>
  <Text style={emailStyles.text}>{props.financialStatusLabel}</Text>
  <Text style={emailStyles.privacy}>Admission depends on your current ticket status. Used admissions retain their check-in history. This link expires {props.expiresAtLabel}.</Text>
 </EmailFrame>
}
