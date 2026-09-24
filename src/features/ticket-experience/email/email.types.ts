export type TicketsReadyProps = {
  recipientLabel: string
  eventName: string
  startsAtLabel: string
  venueName: string
  admissions: readonly { admissionLabel: string; positionLabel: string; statusLabel?: 'Valid' | 'Used'; usedAtLabel?: string }[]
  supportEmail?: string
  expiresAtLabel?: string
  viewTicketsUrl: string
}

export type EventStateEmailProps = {
  viewStatusUrl?: string
  financialStatusLabel?: string
  supportEmail?: string
  expiresAtLabel?: string
  recipientLabel: string
  eventName: string
  startsAtLabel: string
  venueName: string
  viewTicketsUrl?: string
}

export type TicketStateEmailProps = EventStateEmailProps & {
  admissionLabel: string
  positionLabel: string
}

export type TicketRecoveryProps = {
  recipientLabel: string
  supportEmail: string
} & ({ overflow: true; collectionCount?: never; ticketCount?: never; viewTicketsUrl?: never } | {
  overflow?: false; collectionCount: number; ticketCount: number; viewTicketsUrl: string
})

export type OrderRefundedProps = {
  recipientLabel: string; eventName: string; orderNumber: string; amountLabel: string;
  completedAtLabel: string; expiresAtLabel: string; viewOrderUrl: string; supportEmail: string
}

export type EventChangedProps = {
 recipientLabel: string; eventName: string; viewStatusUrl: string; financialStatusLabel: string; supportEmail: string; expiresAtLabel: string;
 changes: { label: string; previous: string; current: string }[]
}

export type OrganizerMessageProps = {
  subject: string; body: string; organizerName: string; eventName: string;
  startsAtLabel: string; venueName: string; supportEmail: string;
  eventUrl?: string; flyerUrl?: string; organizerLogoUrl?: string
}

export type EmailTemplateInput =
  | { kind: 'organizer_message'; props: OrganizerMessageProps }
  | { kind: 'event_changed'; props: EventChangedProps }
  | { kind: 'order_refunded'; props: OrderRefundedProps }
  | { kind: 'ticket_recovery'; props: TicketRecoveryProps }
  | { kind: 'tickets_ready'; props: TicketsReadyProps }
  | { kind: 'event_cancelled'; props: EventStateEmailProps }
  | { kind: 'ticket_refunded'; props: TicketStateEmailProps }

export interface EmailRenderer {
  render(input: EmailTemplateInput): Promise<{ html: string; text: string }>
}

export interface DeliveryTestHarness {
  sendTicketsReady(input: {
    recipient: string
    props: TicketsReadyProps
  }): Promise<{ id: string | null; status: 'accepted' | 'rejected' }>
}

export type SafeResendClient = {
  emails: {
    send(input: {
      from: string
      to: string
      subject: string
      html: string
      text: string
    }): Promise<{ data: { id?: string } | null; error: unknown }>
  }
}

export type TicketReadyCliOptions = {
  recipient: string
  scenario: 'free-rsvp'
  confirmRealSend: boolean
}
