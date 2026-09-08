import type { EmailTemplateInput } from './email.types'

const sharedEvent = {
  eventName: 'Mission Night Market',
  startsAtLabel: 'Saturday, September 12 at 6:00 PM',
  venueName: 'Valencia Street Commons',
} as const

export const emailPreviewScenarios: Readonly<Record<string, EmailTemplateInput>> = {
  'tickets-ready/paid': {
    kind: 'tickets_ready',
    props: {
      ...sharedEvent,
      recipientLabel: 'Demo guest',
      admissions: [
        { admissionLabel: 'General Admission', positionLabel: 'Ticket 1 of 2' },
        { admissionLabel: 'General Admission', positionLabel: 'Ticket 2 of 2' },
      ],
      viewTicketsUrl: 'https://tickets.example.invalid/tickets/wh_test_collection_paid_multi',
    },
  },
  'tickets-ready/free-rsvp': {
    kind: 'tickets_ready',
    props: {
      ...sharedEvent,
      recipientLabel: 'Demo guest',
      admissions: [{ admissionLabel: 'Free RSVP', positionLabel: 'Ticket 1 of 1' }],
      viewTicketsUrl: 'https://tickets.example.invalid/tickets/wh_test_collection_rsvp',
    },
  },
  'event-cancelled/default': {
    kind: 'event_cancelled',
    props: {
      ...sharedEvent,
      recipientLabel: 'Demo guest',
      viewTicketsUrl: 'https://tickets.example.invalid/tickets/wh_test_collection_cancelled',
    },
  },
  'ticket-refunded/default': {
    kind: 'ticket_refunded',
    props: {
      ...sharedEvent,
      recipientLabel: 'Demo guest',
      admissionLabel: 'General Admission',
      positionLabel: 'Ticket 1 of 2',
      viewTicketsUrl: 'https://tickets.example.invalid/tickets/wh_test_collection_refunded',
    },
  },
}
