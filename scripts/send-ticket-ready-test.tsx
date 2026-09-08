import { pathToFileURL } from 'node:url'
import { Resend } from 'resend'
import type {
  DeliveryTestHarness,
  EmailRenderer,
  SafeResendClient,
  TicketReadyCliOptions,
  TicketsReadyProps,
} from '../src/features/ticket-experience/email/email.types'
import { emailRenderer } from '../src/features/ticket-experience/email/renderEmail'

const requiredAcknowledgement = 'I_ACKNOWLEDGE_THIS_SENDS_ONE_TEST_EMAIL'

const freeRsvpTicketsReadyScenario: TicketsReadyProps = {
  recipientLabel: 'Test guest',
  eventName: 'Mission Night Market',
  startsAtLabel: 'Saturday, September 12 at 6:00 PM',
  venueName: 'Valencia Street Commons',
  admissions: [{ admissionLabel: 'Free RSVP', positionLabel: 'Ticket 1 of 1' }],
  viewTicketsUrl: 'https://tickets.example.invalid/tickets/wh_test_collection_rsvp',
}

function isEmailAddress(value: string | undefined): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function createDeliveryTestHarness(input: {
  apiKey: string | undefined
  sender: string | undefined
  renderer: EmailRenderer
  createClient(apiKey: string): SafeResendClient
}): DeliveryTestHarness {
  return {
    async sendTicketsReady({ recipient, props }) {
      if (!input.apiKey?.trim()) throw new Error('Resend test API key required')
      if (!isEmailAddress(input.sender)) throw new Error('Explicit test sender required')
      if (!isEmailAddress(recipient)) throw new Error('Explicit test recipient required')

      const rendered = await input.renderer.render({ kind: 'tickets_ready', props })
      const client = input.createClient(input.apiKey)
      let response: Awaited<ReturnType<SafeResendClient['emails']['send']>>
      try {
        response = await client.emails.send({
          from: input.sender,
          to: recipient,
          subject: `[WHERETO TEST] ${props.eventName}`,
          html: rendered.html,
          text: rendered.text,
        })
      } catch {
        return { id: null, status: 'rejected' }
      }

      if (response.error !== null || response.data === null) {
        return { id: null, status: 'rejected' }
      }
      return { id: response.data.id ?? null, status: 'accepted' }
    },
  }
}

export function parseTicketReadyCliOptions(args: readonly string[]): TicketReadyCliOptions {
  let recipient: string | undefined
  let scenario: string | undefined
  let confirmRealSend = false
  const seen = new Set<string>()

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (!flag || !['--scenario', '--to', '--confirm-real-send'].includes(flag)) {
      throw new Error(`Unknown test-send flag: ${flag ?? ''}`)
    }
    if (seen.has(flag)) throw new Error(`Duplicate test-send flag: ${flag}`)
    seen.add(flag)

    if (flag === '--confirm-real-send') {
      confirmRealSend = true
      continue
    }

    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
    index += 1
    if (flag === '--scenario') scenario = value
    if (flag === '--to') recipient = value
  }

  if (scenario !== 'free-rsvp') throw new Error('Only the free-rsvp test scenario is allowed')
  if (!isEmailAddress(recipient)) throw new Error('Explicit test recipient required')
  if (!confirmRealSend) throw new Error('Explicit real-send confirmation required')

  return { recipient, scenario, confirmRealSend }
}

type CliEnvironment = Readonly<Record<string, string | undefined>>

export async function runTicketReadyCli(input: {
  args: readonly string[]
  env: CliEnvironment
  renderer: EmailRenderer
  createClient(apiKey: string): SafeResendClient
}) {
  const options = parseTicketReadyCliOptions(input.args)
  if (input.env.WHERETO_RESEND_TEST_SEND !== requiredAcknowledgement) {
    throw new Error('Exact test-send environment acknowledgement required')
  }

  const harness = createDeliveryTestHarness({
    apiKey: input.env.RESEND_API_KEY,
    sender: input.env.RESEND_TEST_FROM,
    renderer: input.renderer,
    createClient: input.createClient,
  })
  return harness.sendTicketsReady({ recipient: options.recipient, props: freeRsvpTicketsReadyScenario })
}

function createResendClient(apiKey: string): SafeResendClient {
  const resend = new Resend(apiKey)
  return {
    emails: {
      async send(input) {
        const response = await resend.emails.send(input)
        return {
          data: response.data ? { id: response.data.id } : null,
          error: response.error,
        }
      },
    },
  }
}

export async function main() {
  const result = await runTicketReadyCli({
    args: process.argv.slice(2),
    env: process.env,
    renderer: emailRenderer,
    createClient: createResendClient,
  })
  console.log(JSON.stringify(result))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main().catch(() => {
    console.error('Ticket-ready test send stopped safely.')
    process.exitCode = 1
  })
}
