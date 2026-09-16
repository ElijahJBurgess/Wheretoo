import { describe, expect, it } from 'vitest'
import { emailRendererContract } from './emailContractTests'
import type {
  EventStateEmailProps,
  TicketStateEmailProps,
  TicketsReadyProps,
} from './email.types'
import { emailRenderer } from './renderEmail'

export const paidTicketsReadyProps: TicketsReadyProps = {
  recipientLabel: 'Jordan',
  eventName: 'Mission Night Market',
  startsAtLabel: 'Saturday, September 12 at 6:00 PM',
  venueName: 'Valencia Street Commons',
  admissions: [
    { admissionLabel: 'General Admission', positionLabel: 'Ticket 1 of 2' },
    { admissionLabel: 'General Admission', positionLabel: 'Ticket 2 of 2' },
  ],
  viewTicketsUrl: 'https://tickets.example.invalid/tickets/wh_test_collection_paid_multi',
}

export const freeRsvpTicketsReadyProps: TicketsReadyProps = {
  recipientLabel: 'Riley',
  eventName: 'Mission Night Market',
  startsAtLabel: 'Saturday, September 12 at 6:00 PM',
  venueName: 'Valencia Street Commons',
  admissions: [
    { admissionLabel: 'Free RSVP', positionLabel: 'Ticket 1 of 1' },
  ],
  viewTicketsUrl: 'https://tickets.example.invalid/tickets/wh_test_collection_rsvp',
}

export const eventCancelledProps: EventStateEmailProps = {
  recipientLabel: 'Jordan',
  eventName: 'Mission Night Market',
  startsAtLabel: 'Saturday, September 12 at 6:00 PM',
  venueName: 'Valencia Street Commons',
  viewTicketsUrl: 'https://tickets.example.invalid/tickets/wh_test_collection_cancelled',
}

export const ticketRefundedProps: TicketStateEmailProps = {
  recipientLabel: 'Jordan',
  eventName: 'Mission Night Market',
  startsAtLabel: 'Saturday, September 12 at 6:00 PM',
  venueName: 'Valencia Street Commons',
  admissionLabel: 'General Admission',
  positionLabel: 'Ticket 1 of 2',
  viewTicketsUrl: 'https://tickets.example.invalid/tickets/wh_test_collection_refunded',
}

emailRendererContract('React Email renderer', () => emailRenderer, {
  paidReady: paidTicketsReadyProps,
  freeReady: freeRsvpTicketsReadyProps,
  cancelled: eventCancelledProps,
  refunded: ticketRefundedProps,
})

describe('emailRenderer privacy and content boundaries', () => {
  it.each([
    ['paid', paidTicketsReadyProps],
    ['free RSVP', freeRsvpTicketsReadyProps],
  ])('renders source-neutral Tickets ready output for %s admissions', async (_source, props) => {
    const output = await emailRenderer.render({ kind: 'tickets_ready', props })

    expect(output.html.match(/>View Tickets</g)).toHaveLength(1)
    expect(output.text.toLowerCase()).toContain(props.eventName.toLowerCase())
    expect(output.text).toContain(props.admissions[0]?.admissionLabel)
    expect(output.text).toContain(props.viewTicketsUrl)
    expect(output.html).not.toMatch(/admission.?credential|qr.?code|stripe|receipt|reminder|payment/i)
    expect(output.html).not.toMatch(/@font-face|fonts\.google|<img/i)
  })

  it('renders one factual cancellation link without promising refund behavior', async () => {
    const output = await emailRenderer.render({ kind: 'event_cancelled', props: eventCancelledProps })

    expect(output.text.toLowerCase()).toContain('has been cancelled')
    expect(output.html.match(/>View Tickets</g)).toHaveLength(1)
    expect(output.text).not.toMatch(/amount|business days|original payment|refund (will|should|arrives?)/i)
  })

  it('renders the refunded ticket identity without amount, method, or timing claims', async () => {
    const output = await emailRenderer.render({ kind: 'ticket_refunded', props: ticketRefundedProps })

    expect(output.text).toContain('General Admission')
    expect(output.text).toContain('Ticket 1 of 2')
    expect(output.text).toContain('has been refunded')
    expect(output.text).not.toMatch(/\$|amount|business days|original payment|card ending/i)
  })
})

describe('delivery and recovery emails', () => {
  it('preserves mixed admission history and gives a support reply destination', async () => {
    const output = await emailRenderer.render({ kind: 'tickets_ready', props: { ...paidTicketsReadyProps, supportEmail: 'help@example.invalid', expiresAtLabel: 'November 12 at 8 PM PST', admissions: [{ admissionLabel: 'General Admission', positionLabel: 'Ticket 1 of 2', statusLabel: 'Used', usedAtLabel: 'September 11 at 7 PM PDT' }, { admissionLabel: 'General Admission', positionLabel: 'Ticket 2 of 2', statusLabel: 'Valid' }] } })
    expect(output.text).toContain('Used')
    expect(output.text).toContain('Valid')
    expect(output.text).toContain('September 11 at 7 PM PDT')
    expect(output.text).toContain('2 existing tickets')
    expect(output.text).toContain('help@example.invalid')
    expect(output.text).toContain('November 12 at 8 PM PST')
    expect(output.html).toContain('#12101d')
  })
  it('renders a recovery count, fixed lifetime, and separate existing collections', async () => {
    const output = await emailRenderer.render({kind:'ticket_recovery',props:{recipientLabel:'there',collectionCount:3,ticketCount:5,viewTicketsUrl:'https://tickets.example.invalid/ticket-access#em1_test',supportEmail:'help@example.invalid'}})
    expect(output.text).toContain('5 existing tickets')
    expect(output.text).toContain('3 separate collections')
    expect(output.text).toContain('24 hours')
    expect(output.text).toMatch(/View my tickets/i)
    expect(output.html).not.toMatch(/qr.?code|admission.?credential|<img/i)
  })
  it('overflow uses neutral configured support without an access link or truncated count', async () => {
    const output = await emailRenderer.render({kind:'ticket_recovery',props:{recipientLabel:'there',overflow:true,supportEmail:'help@example.invalid'}})
    expect(output.text).toContain('help@example.invalid')
    expect(output.text).not.toMatch(/View my tickets|200|24 hours|em1_|ticket-access/i)
    expect(output.text).toContain('help you recover access')
  })
})
