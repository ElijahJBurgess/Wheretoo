import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import { OrganizerMessagePage } from './OrganizerMessagePage'
const api = vi.hoisted(() => ({
  options: vi.fn(),
  preview: vi.fn(),
  submit: vi.fn(),
  receipt: vi.fn(),
}))
const identity = vi.hoisted(() => ({ id: 'owner', version: 0 }))
vi.mock(
  '../auth/SessionProvider',
  () => ({
    useSession: () => ({
      status: 'authenticated',
      user: { id: identity.id },
      identityVersion: identity.version,
    }),
  }),
)
vi.mock(
  './messages.api',
  () => ({
    messageApi: api,
    MessageError: class extends Error {
      constructor(public code: string, public outcome = 'unknown') {
        super(code)
      }
    },
  }),
)
const event = '11111111-1111-4111-8111-111111111111'
const preview = {
  recipientCount: 2,
  canSend: true,
  reason: null,
  audienceLabel: 'Everyone',
  subject: 'Update',
  body: 'Doors at six',
  fingerprint: 'fingerprint',
  text: 'Wheretoo\nDoors at six\nView Event',
  from: 'Host via Wheretoo',
  replyTo: 'support@example.invalid',
  html: '<script>bad()</script>',
  deadline: null,
}
function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter
        initialEntries={[`/organizer/events/${event}/email-attendees`]}
      >
        <Routes>
          <Route
            path='/organizer/events/:eventId/email-attendees'
            element={<OrganizerMessagePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
async function compose() {
  await userEvent.type(await screen.findByLabelText('Subject'), 'Update')
  await userEvent.type(screen.getByLabelText('Message'), 'Doors at six')
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByRole('button', { name: 'Send to 2 people' })
}
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  identity.id = 'owner'
  identity.version = 0
  api.options.mockResolvedValue({
    eventId: event,
    admissionType: 'paid',
    canSend: true,
    tiers: [],
    reason: null,
  })
  api.preview.mockResolvedValue(preview)
  api.receipt.mockResolvedValue(null)
})
test('previews server text without executable HTML and queues once on double click', async () => {
  api.submit.mockResolvedValue({ queuedRecipients: 2 })
  mount()
  await compose()
  expect(document.querySelector('script')).toBeNull()
  await userEvent.dblClick(
    screen.getByRole('button', { name: 'Send to 2 people' }),
  )
  expect(await screen.findByText('Message queued for 2 recipients.'))
    .toBeVisible()
  expect(api.submit).toHaveBeenCalledTimes(1)
})
test('unknown outcome keeps same request and original intent after null receipt', async () => {
  api.submit.mockRejectedValue(new Error('network'))
  mount()
  await compose()
  await userEvent.click(
    screen.getByRole('button', { name: 'Send to 2 people' }),
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Check send status' }),
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Retry same send' }),
  )
  expect(api.submit).toHaveBeenCalledTimes(2)
  expect(api.submit.mock.calls[1]).toEqual(api.submit.mock.calls[0])
  expect(sessionStorage.getItem(`organizer-message:v1:owner:${event}`)).not
    .toContain('Doors')
})
test('reload preserves unresolved request without permitting a new send', async () => {
  sessionStorage.setItem(
    `organizer-message:v1:owner:${event}`,
    JSON.stringify({
      ownerId: 'owner',
      eventId: event,
      requestId: '22222222-2222-4222-8222-222222222222',
    }),
  )
  mount()
  expect(await screen.findByRole('button', { name: 'Check send status' }))
    .toBeVisible()
  expect(screen.queryByLabelText('Subject')).toBeNull()
  await userEvent.click(
    screen.getByRole('button', { name: 'Check send status' }),
  )
  expect(screen.queryByRole('button', { name: 'Retry same send' })).toBeNull()
  expect(screen.queryByLabelText('Subject')).toBeNull()
})
test('zero audience cannot send', async () => {
  api.preview.mockResolvedValue({
    ...preview,
    recipientCount: 0,
    canSend: false,
    reason: 'NO_RECIPIENTS',
  })
  mount()
  await userEvent.type(await screen.findByLabelText('Subject'), 'Update')
  await userEvent.type(screen.getByLabelText('Message'), 'Doors')
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
  expect(await screen.findByText(/No eligible recipients/)).toBeVisible()
  expect(screen.queryByRole('button', { name: /Send to/ })).toBeNull()
})
test('storage failure prevents sending without durable protection', async () => {
  mount()
  await compose()
  const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Send to 2 people' }),
  )
  expect(await screen.findByText(/Browser storage is unavailable/))
    .toBeVisible()
  expect(api.submit).not.toHaveBeenCalled()
  fail.mockRestore()
})
test('account switch clears draft and ignores stale preview', async () => {
  let resolve!: (value: typeof preview) => void
  api.preview.mockReturnValue(
    new Promise((r) => {
      resolve = r
    }),
  )
  const view = mount()
  await userEvent.type(await screen.findByLabelText('Subject'), 'Private')
  await userEvent.type(screen.getByLabelText('Message'), 'Private body')
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
  identity.id = 'other'
  identity.version++
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter
        initialEntries={[`/organizer/events/${event}/email-attendees`]}
      >
        <Routes>
          <Route
            path='/organizer/events/:eventId/email-attendees'
            element={<OrganizerMessagePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  resolve(preview)
  await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue(''))
  expect(screen.queryByText('Doors at six')).toBeNull()
})
test.each(['PREVIEW_CHANGED', 'LIMIT_REACHED', 'EMAIL_UNAVAILABLE'])(
  'explicit %s rollback requires a fresh preview',
  async (code) => {
    const { MessageError } = await import('./messages.api')
    api.submit.mockRejectedValue(new MessageError(code, 'not_queued'))
    mount()
    await compose()
    await userEvent.click(
      screen.getByRole('button', { name: 'Send to 2 people' }),
    )
    expect(await screen.findByRole('button', { name: 'Preview' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Send to 2 people' }))
      .toBeNull()
    expect(sessionStorage.getItem(`organizer-message:v1:owner:${event}`))
      .toBeNull()
  },
)
test('request conflict stays blocked even when rejection says not queued', async () => {
  const { MessageError } = await import('./messages.api')
  api.submit.mockRejectedValue(
    new MessageError('REQUEST_CONFLICT', 'not_queued'),
  )
  mount()
  await compose()
  await userEvent.click(
    screen.getByRole('button', { name: 'Send to 2 people' }),
  )
  expect(await screen.findByRole('button', { name: 'Check send status' }))
    .toBeVisible()
  expect(screen.queryByLabelText('Subject')).toBeNull()
  expect(sessionStorage.getItem(`organizer-message:v1:owner:${event}`)).not
    .toBeNull()
})

test.each(['UNAUTHORIZED', 'PREVIEW_CHANGED'])('unknown original retains its request after retry rejects with %s/not_queued', async code => {
  const { MessageError } = await import('./messages.api')
  api.submit.mockRejectedValueOnce(new Error('lost original response')).mockRejectedValueOnce(new MessageError(code, 'not_queued'))
  mount()
  await compose()
  await userEvent.click(screen.getByRole('button', { name: 'Send to 2 people' }))
  const original = sessionStorage.getItem(`organizer-message:v1:owner:${event}`)
  expect(original).not.toBeNull()
  await userEvent.click(await screen.findByRole('button', { name: 'Retry same send' }))
  expect(sessionStorage.getItem(`organizer-message:v1:owner:${event}`)).toBe(original)
  expect(screen.queryByLabelText('Subject')).toBeNull()
  expect(screen.getByRole('button', { name: 'Check send status' })).toBeVisible()
  expect(api.submit.mock.calls[1]).toEqual(api.submit.mock.calls[0])
  api.receipt.mockResolvedValue({ queuedRecipients: 2 })
  await userEvent.click(screen.getByRole('button', { name: 'Check send status' }))
  expect(await screen.findByText('Message queued for 2 recipients.')).toBeVisible()
  expect(sessionStorage.getItem(`organizer-message:v1:owner:${event}`)).toBeNull()
})

test('pending preview locks editing and confirmation retains its original audience', async () => {
  const tierId = '33333333-3333-4333-8333-333333333333'
  api.options.mockResolvedValue({ eventId: event, admissionType: 'paid', canSend: true, tiers: [{ id: tierId, name: 'VIP', archived: false }], reason: null })
  let resolve!: (value: typeof preview) => void
  api.preview.mockReturnValue(new Promise(r => { resolve = r }))
  api.submit.mockResolvedValue({ queuedRecipients: 2 })
  mount()
  await userEvent.type(await screen.findByLabelText('Subject'), 'Update')
  await userEvent.type(screen.getByLabelText('Message'), 'Doors at six')
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
  const audience = screen.getByRole('combobox', { name: 'Audience' })
  expect(audience).toBeDisabled()
  expect(screen.getByLabelText('Subject')).toBeDisabled()
  expect(screen.getByLabelText('Message')).toBeDisabled()
  await userEvent.selectOptions(audience, tierId)
  resolve(preview)
  await userEvent.click(await screen.findByRole('button', { name: 'Send to 2 people' }))
  expect(api.submit.mock.calls[0][1]).toMatchObject({ selector: { kind: 'everyone' }, fingerprint: preview.fingerprint })
})
