import { emailRenderer } from '../../src/features/ticket-experience/email/renderEmail'

const output = await emailRenderer.render({
  kind: 'tickets_ready',
  props: {
    recipientLabel: 'Runtime test guest',
    eventName: 'Runtime Test Event',
    startsAtLabel: 'Saturday at 6:00 PM',
    venueName: 'Test Venue',
    admissions: [{ admissionLabel: 'Free RSVP', positionLabel: 'Ticket 1 of 1' }],
    viewTicketsUrl: 'https://tickets.example.invalid/tickets/wh_test_collection_runtime',
  },
})

if (!output.html.includes('Runtime Test Event')) {
  throw new Error('Node email renderer returned unexpected output')
}

console.log('node-email-render=passed')
