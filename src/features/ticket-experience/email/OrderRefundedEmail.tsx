import { Section, Text } from '@react-email/components'
import type { OrderRefundedProps } from './email.types'
import { EmailFrame } from './EmailFrame'
import { emailStyles } from './emailStyles'

export function OrderRefundedEmail(props: OrderRefundedProps) {
  return <EmailFrame eyebrow="Order refunded" preview={`Your ${props.eventName} order was refunded`}
    recipientLabel={props.recipientLabel} title="Your order was refunded"
    viewTicketsUrl={props.viewOrderUrl} actionLabel="View order details"
    privacyLabel="This private link opens your refund details. Keep it to yourself." supportEmail={props.supportEmail}>
    <Text style={emailStyles.text}>Your whole order of {props.amountLabel} for {props.eventName} has been refunded. Unused tickets can no longer be used for entry. Any prior check-in remains recorded.</Text>
    <Section style={emailStyles.facts}>
      <Text style={emailStyles.fact}><strong>Order</strong><br />{props.orderNumber}</Text>
      <Text style={emailStyles.fact}><strong>Refund completed</strong><br />{props.completedAtLabel}</Text>
      <Text style={emailStyles.fact}><strong>Refund amount</strong><br />{props.amountLabel}</Text>
    </Section>
    <Text style={emailStyles.privacy}>Your payment provider determines when the refund appears in your account. This private link expires {props.expiresAtLabel}.</Text>
  </EmailFrame>
}
