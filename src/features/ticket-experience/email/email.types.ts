export type EmailBrandProps = {
  /** Public asset host; defaults to the ticket-link origin. Required for linkless mail. */
  brandAssetOrigin?: string
}

export type TicketsReadyProps = EmailBrandProps & {
  recipientLabel: string
  eventName: string
  startsAtLabel: string
  venueName: string
  admissions: readonly { admissionLabel: string; positionLabel: string }[]
  viewTicketsUrl: string
}

export type EventStateEmailProps = EmailBrandProps & {
  recipientLabel: string
  eventName: string
  startsAtLabel: string
  venueName: string
} & (
  | { viewTicketsUrl: string }
  | { viewTicketsUrl?: undefined; brandAssetOrigin: string }
)

export type TicketStateEmailProps = EventStateEmailProps & {
  admissionLabel: string
  positionLabel: string
}

export type EmailTemplateInput =
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
