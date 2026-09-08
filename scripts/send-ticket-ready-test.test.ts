import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { deliveryTestHarnessContract } from '../src/features/ticket-experience/email/emailContractTests'
import type { EmailRenderer, SafeResendClient } from '../src/features/ticket-experience/email/email.types'
import { emailRenderer } from '../src/features/ticket-experience/email/renderEmail'
import {
  createDeliveryTestHarness,
  parseTicketReadyCliOptions,
  runTicketReadyCli,
} from './send-ticket-ready-test'

const freeRsvpProps = {
  recipientLabel: 'Test guest',
  eventName: 'Mission Night Market',
  startsAtLabel: 'Saturday, September 12 at 6:00 PM',
  venueName: 'Valencia Street Commons',
  admissions: [{ admissionLabel: 'Free RSVP', positionLabel: 'Ticket 1 of 1' }],
  viewTicketsUrl: 'https://tickets.example.invalid/tickets/wh_test_collection_rsvp',
} as const

deliveryTestHarnessContract(
  'Resend delivery test harness',
  ({ apiKey, sender }) => createDeliveryTestHarness({
    apiKey,
    sender,
    renderer: emailRenderer,
    createClient: () => ({ emails: { send: vi.fn(async () => ({ data: { id: 'email_test_123' }, error: null })) } }),
  }),
  {
    validRecipient: 'recipient@example.com',
    invalidRecipient: 'not-an-email',
    ticketsReady: freeRsvpProps,
  },
)

describe('ticket-ready CLI gates', () => {
  const validArgs = ['--scenario', 'free-rsvp', '--to', 'recipient@example.com', '--confirm-real-send']
  const acknowledgedEnv = {
    RESEND_API_KEY: 'runtime-test-key',
    RESEND_TEST_FROM: 'sender@example.com',
    WHERETO_RESEND_TEST_SEND: 'I_ACKNOWLEDGE_THIS_SENDS_ONE_TEST_EMAIL',
  }

  it('selects the script tsconfig when Node executes the TSX email renderer', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const scriptsTsconfig = JSON.parse(readFileSync(resolve(process.cwd(), 'tsconfig.scripts.json'), 'utf8')) as {
      include?: string[]
    }

    expect(packageJson.scripts?.['email:test:ticket-ready'])
      .toBe('tsx --tsconfig tsconfig.scripts.json scripts/send-ticket-ready-test.tsx')
    expect(scriptsTsconfig.include).toContain('src/features/ticket-experience/email/**/*.ts*')
  })

  it('renders the Tickets-ready JSX graph in the real Node/tsx runtime', () => {
    const result = spawnSync(
      resolve(process.cwd(), 'node_modules/.bin/tsx'),
      [
        '--tsconfig',
        'tsconfig.scripts.json',
        'scripts/test-fixtures/render-ticket-ready.ts',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
        },
      },
    )

    expect(result.stderr).not.toContain('React is not defined')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('node-email-render=passed')
  })

  it('requires the one fixed scenario, explicit recipient, and confirmation flag', () => {
    expect(parseTicketReadyCliOptions([
      '--scenario', 'free-rsvp',
      '--to', 'recipient@example.com',
      '--confirm-real-send',
    ])).toEqual({
      scenario: 'free-rsvp',
      recipient: 'recipient@example.com',
      confirmRealSend: true,
    })

    expect(() => parseTicketReadyCliOptions(['--scenario', 'paid', '--to', 'recipient@example.com', '--confirm-real-send']))
      .toThrow('Only the free-rsvp test scenario is allowed')
    expect(() => parseTicketReadyCliOptions(['--scenario', 'free-rsvp', '--confirm-real-send']))
      .toThrow('Explicit test recipient required')
    expect(() => parseTicketReadyCliOptions(['--scenario', 'free-rsvp', '--to', 'recipient@example.com']))
      .toThrow('Explicit real-send confirmation required')
    expect(() => parseTicketReadyCliOptions([]))
      .toThrow('Only the free-rsvp test scenario is allowed')
  })

  it.each([
    ['unknown flags', ['--scenario', 'free-rsvp', '--to', 'recipient@example.com', '--confirm-real-send', '--verbose']],
    ['duplicate flags', ['--scenario', 'free-rsvp', '--scenario', 'free-rsvp', '--to', 'recipient@example.com', '--confirm-real-send']],
  ])('rejects %s rather than guessing intent', (_case, args) => {
    expect(() => parseTicketReadyCliOptions(args)).toThrow()
  })

  it.each([
    ['missing CLI confirmation', ['--scenario', 'free-rsvp', '--to', 'recipient@example.com'], acknowledgedEnv],
    ['missing API key', validArgs, { RESEND_TEST_FROM: 'sender@example.com', WHERETO_RESEND_TEST_SEND: 'I_ACKNOWLEDGE_THIS_SENDS_ONE_TEST_EMAIL' }],
    ['missing sender', validArgs, { RESEND_API_KEY: 'runtime-test-key', WHERETO_RESEND_TEST_SEND: 'I_ACKNOWLEDGE_THIS_SENDS_ONE_TEST_EMAIL' }],
    ['missing acknowledgement', validArgs, { RESEND_API_KEY: 'runtime-test-key', RESEND_TEST_FROM: 'sender@example.com' }],
    ['incorrect acknowledgement', validArgs, { RESEND_API_KEY: 'runtime-test-key', RESEND_TEST_FROM: 'sender@example.com', WHERETO_RESEND_TEST_SEND: 'yes' }],
  ])('fails before client construction for %s', async (_case, args, env) => {
    const createClient = vi.fn()

    await expect(runTicketReadyCli({
      args,
      env,
      renderer: emailRenderer,
      createClient,
    })).rejects.toThrow()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('rejects an empty recipient before rendering or client construction', async () => {
    const createClient = vi.fn()
    await expect(runTicketReadyCli({
      args: ['--scenario', 'free-rsvp', '--to', '', '--confirm-real-send'],
      env: {
        RESEND_API_KEY: 'runtime-test-key',
        RESEND_TEST_FROM: 'sender@example.com',
        WHERETO_RESEND_TEST_SEND: 'I_ACKNOWLEDGE_THIS_SENDS_ONE_TEST_EMAIL',
      },
      renderer: emailRenderer,
      createClient,
    })).rejects.toThrow('Missing value for --to')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('makes exactly one provider call with allowlisted test content and returns safe diagnostics', async () => {
    const send = vi.fn<SafeResendClient['emails']['send']>().mockResolvedValue({
      data: { id: 'email_test_123' },
      error: null,
    })
    const createClient = vi.fn((): SafeResendClient => ({ emails: { send } }))

    const result = await runTicketReadyCli({
      args: validArgs,
      env: acknowledgedEnv,
      renderer: emailRenderer,
      createClient,
    })

    expect(result).toEqual({ id: 'email_test_123', status: 'accepted' })
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: '[WHERETO TEST] Mission Night Market',
    }))
    const providerInput = send.mock.calls[0]?.[0]
    expect(providerInput?.html).toContain('Free RSVP')
    expect(providerInput?.html).not.toMatch(/admission.?credential|qr.?code/i)
  })

  it('reduces rejected provider output without exposing the raw error', async () => {
    const privateProviderError = { message: 'private provider response', request: { authorization: 'secret' } }
    const renderer: EmailRenderer = { render: vi.fn(async () => ({ html: '<p>safe</p>', text: 'safe' })) }
    const harness = createDeliveryTestHarness({
      apiKey: 'runtime-test-key',
      sender: 'sender@example.com',
      renderer,
      createClient: () => ({
        emails: { send: vi.fn(async () => ({ data: null, error: privateProviderError })) },
      }),
    })

    await expect(harness.sendTicketsReady({ recipient: 'recipient@example.com', props: freeRsvpProps }))
      .resolves.toEqual({ id: null, status: 'rejected' })
  })

  it('reduces a thrown provider failure to the same safe rejection result', async () => {
    const harness = createDeliveryTestHarness({
      apiKey: 'runtime-test-key',
      sender: 'sender@example.com',
      renderer: emailRenderer,
      createClient: () => ({
        emails: { send: vi.fn(async () => { throw new Error('private provider response') }) },
      }),
    })

    await expect(harness.sendTicketsReady({ recipient: 'recipient@example.com', props: freeRsvpProps }))
      .resolves.toEqual({ id: null, status: 'rejected' })
  })
})
