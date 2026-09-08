import { render, toPlainText } from '@react-email/render'
import { createElement } from 'react'
import type { EmailRenderer, EmailTemplateInput } from './email.types'
import { EventCancelledEmail } from './EventCancelledEmail'
import { TicketRefundedEmail } from './TicketRefundedEmail'
import { TicketsReadyEmail } from './TicketsReadyEmail'

function assertNever(value: never): never {
  throw new Error(`Unsupported email template: ${String(value)}`)
}

function templateFor(input: EmailTemplateInput) {
  switch (input.kind) {
    case 'tickets_ready':
      return createElement(TicketsReadyEmail, input.props)
    case 'event_cancelled':
      return createElement(EventCancelledEmail, input.props)
    case 'ticket_refunded':
      return createElement(TicketRefundedEmail, input.props)
    default:
      return assertNever(input)
  }
}

export const emailRenderer: EmailRenderer = {
  async render(input) {
    const html = await render(templateFor(input))
    return { html, text: toPlainText(html) }
  },
}
