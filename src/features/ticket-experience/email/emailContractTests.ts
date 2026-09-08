import { describe, expect, it } from 'vitest'
import type {
  DeliveryTestHarness,
  EmailRenderer,
  EventStateEmailProps,
  TicketStateEmailProps,
  TicketsReadyProps,
} from './email.types'

export function emailRendererContract(
  name: string,
  makeRenderer: () => EmailRenderer,
  cases: {
    paidReady: TicketsReadyProps
    freeReady: TicketsReadyProps
    cancelled: EventStateEmailProps
    refunded: TicketStateEmailProps
  },
): void {
  describe(`${name} contract`, () => {
    it.each([
      ['paid', cases.paidReady],
      ['free RSVP', cases.freeReady],
    ])('renders %s admissions through the same Tickets ready kind', async (_source, props) => {
      const output = await makeRenderer().render({ kind: 'tickets_ready', props })

      expect(output.html).toContain(props.eventName)
      expect(output.text).toContain(props.admissions[0]?.admissionLabel)
      expect(output.text).toContain(props.viewTicketsUrl)
    })

    it('renders the cancelled kind from event-state props', async () => {
      const output = await makeRenderer().render({ kind: 'event_cancelled', props: cases.cancelled })
      expect(output.text.toLowerCase()).toContain(cases.cancelled.eventName.toLowerCase())
      expect(output.text.toLowerCase()).toContain('cancelled')
    })

    it('renders the refunded kind from ticket-state props', async () => {
      const output = await makeRenderer().render({ kind: 'ticket_refunded', props: cases.refunded })
      expect(output.text).toContain(cases.refunded.admissionLabel)
      expect(output.text.toLowerCase()).toContain('refunded')
    })
  })
}

export function deliveryTestHarnessContract(
  name: string,
  makeHarness: (input: {
    apiKey: string | undefined
    sender: string | undefined
  }) => DeliveryTestHarness,
  cases: {
    validRecipient: string
    invalidRecipient: string
    ticketsReady: TicketsReadyProps
  },
): void {
  describe(`${name} contract`, () => {
    it('requires an API key before rendering or delivery', async () => {
      await expect(makeHarness({ apiKey: undefined, sender: 'sender@example.com' }).sendTicketsReady({
        recipient: cases.validRecipient,
        props: cases.ticketsReady,
      })).rejects.toThrow('Resend test API key required')
    })

    it('requires an explicit sender', async () => {
      await expect(makeHarness({ apiKey: 'runtime-test-key', sender: undefined }).sendTicketsReady({
        recipient: cases.validRecipient,
        props: cases.ticketsReady,
      })).rejects.toThrow('Explicit test sender required')
    })

    it('requires an explicit recipient', async () => {
      await expect(makeHarness({ apiKey: 'runtime-test-key', sender: 'sender@example.com' }).sendTicketsReady({
        recipient: cases.invalidRecipient,
        props: cases.ticketsReady,
      })).rejects.toThrow('Explicit test recipient required')
    })

    it('returns only allowlisted acceptance diagnostics', async () => {
      const result = await makeHarness({
        apiKey: 'runtime-test-key',
        sender: 'sender@example.com',
      }).sendTicketsReady({
        recipient: cases.validRecipient,
        props: cases.ticketsReady,
      })

      expect(result).toEqual({ id: 'email_test_123', status: 'accepted' })
      expect(Object.keys(result)).toEqual(['id', 'status'])
    })
  })
}
