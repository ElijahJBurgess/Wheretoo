import { beforeEach, expect, test, vi } from 'vitest'
import { messageApi } from './messages.api'
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), invoke: vi.fn() }))
vi.mock(
  '../../lib/supabase/client',
  () => ({
    supabase: {
      auth: { getSession: mocks.getSession },
      functions: { invoke: mocks.invoke },
    },
  }),
)
const eventId = '11111111-1111-4111-8111-111111111111',
  requestId = '22222222-2222-4222-8222-222222222222'
const intent = {
  eventId,
  requestId,
  selector: { kind: 'everyone' as const },
  subject: 'Update',
  body: 'Doors at six',
  fingerprint: 'proof',
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({
    data: { session: { user: { id: 'owner' }, access_token: 'owner-token' } },
  })
})
test('submission contains only authorized intent fields and owner bearer', async () => {
  mocks.invoke.mockResolvedValue({
    data: {
      receipt: {
        messageId: eventId,
        requestId,
        queuedRecipients: 1,
        confirmedAt: 'now',
      },
    },
  })
  await messageApi.submit('owner', intent)
  expect(mocks.invoke).toHaveBeenCalledWith('organizer-message', {
    body: { action: 'submit', ...intent },
    headers: { Authorization: 'Bearer owner-token' },
  })
})
test('identity mismatch cannot dispatch', async () => {
  await expect(messageApi.submit('other', intent)).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
    outcome: 'not_queued',
  })
  expect(mocks.invoke).not.toHaveBeenCalled()
})
test.each([{ data: null, error: new Error('network') }, {
  data: { receipt: {} },
}, {
  data: {
    receipt: {
      messageId: eventId,
      requestId: eventId,
      queuedRecipients: 1,
      confirmedAt: 'now',
    },
  },
}])('malformed or failed submissions remain unknown', async (response) => {
  mocks.invoke.mockResolvedValue(response)
  await expect(messageApi.submit('owner', intent)).rejects.toMatchObject({
    outcome: 'unknown',
  })
})
test('only explicit facade outcome establishes not queued', async () => {
  mocks.invoke.mockResolvedValue({
    error: {
      context: new Response(
        JSON.stringify({
          error: { code: 'PREVIEW_CHANGED', submissionOutcome: 'not_queued' },
        }),
      ),
    },
  })
  await expect(messageApi.submit('owner', intent)).rejects.toMatchObject({
    code: 'PREVIEW_CHANGED',
    outcome: 'not_queued',
  })
})

test('a local auth read error rejects only this attempt without dispatching a request', async () => {
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: new Error('auth read unavailable') })
  await expect(messageApi.submit('owner', intent)).rejects.toMatchObject({ code: 'UNAUTHORIZED', outcome: 'not_queued' })
  expect(mocks.invoke).not.toHaveBeenCalled()
})
