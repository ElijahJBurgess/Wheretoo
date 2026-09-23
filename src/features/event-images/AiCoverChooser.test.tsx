import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ request: vi.fn(), select: vi.fn() }))
vi.mock(
  '../auth/SessionProvider',
  () => ({
    useSession: () => ({
      user: { id: 'owner' },
      identityVersion: 1,
      status: 'authenticated',
    }),
  }),
)
vi.mock(
  '../auth/identityLifetime',
  () => ({ captureIdentityLifetime: () => () => true }),
)
vi.mock(
  './aiCover.api',
  async (importOriginal) => ({
    ...await importOriginal<typeof import('./aiCover.api')>(),
    requestAiCover: api.request,
  }),
)
vi.mock('./coverTransport', () => ({ mutateCover: api.select }))
import { AiCoverChooser } from './AiCoverChooser'
const generation = {
  id: 'gen',
  eventId: 'event',
  expectedRevision: 4,
  input: { mood: 'Editorial', direction: '' },
  selectedSlot: null,
  expired: false,
  expiresAt: 'later',
  candidates: [1, 2, 3].map((slot) => ({
    id: `candidate${slot}`,
    slot,
    status: slot === 2 ? 'failed' : 'ready',
    attempts: 1,
    path: slot === 2 ? null : `private/${slot}.png`,
    url: slot === 2 ? null : `https://private.invalid/${slot}`,
    failureCode: slot === 2 ? 'PROVIDER_FAILED' : null,
    retryAfter: '2000-01-01T00:00:00Z',
  })),
}
function show(props = {}) {
  return render(
    <QueryClientProvider
      client={new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })}
    >
      <AiCoverChooser
        eventId='event'
        revision={4}
        latestGenerationId='gen'
        {...props}
      />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  api.request.mockResolvedValue(generation)
  api.select.mockResolvedValue(undefined)
})
it('restores private candidates, keeps successes and retries only failed slot', async () => {
  show()
  expect(await screen.findAllByRole('img')).toHaveLength(2)
  await userEvent.setup().click(
    screen.getByRole('button', { name: 'Retry cover 2' }),
  )
  expect(api.request).toHaveBeenCalledWith({
    action: 'step',
    generationId: 'gen',
    slot: 2,
    attempt: 1,
  }, expect.any(Function))
})
it('selects explicitly through Phase 1 contract with original revision', async () => {
  show()
  await userEvent.setup().click(
    (await screen.findAllByRole('button', { name: 'Use this cover' }))[0],
  )
  expect(api.select).toHaveBeenCalledWith('event', 4, {
    generationId: 'gen',
    slot: 1,
  }, expect.any(Function))
})
it('blocks stale selection after a manual replacement', async () => {
  show({ revision: 5 })
  await screen.findAllByRole('img')
  expect(screen.getAllByRole('button', { name: 'Use this cover' })[0])
    .toBeDisabled()
  expect(api.select).not.toHaveBeenCalled()
})
it('automatically resumes only unstarted slots on reopen', async () => {
  const pending = {
    ...generation,
    candidates: generation.candidates.map((c) =>
      c.slot === 2
        ? { ...c, status: 'pending', attempts: 0, failureCode: null }
        : c
    ),
  }
  api.request.mockImplementation(async (body) =>
    body.action === 'step' ? generation : pending
  )
  show()
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith({
      action: 'step',
      generationId: 'gen',
      slot: 2,
      attempt: 0,
    }, expect.any(Function))
  )
})
it('asks to save a draft first and never silently creates one', () => {
  show({ eventId: '', latestGenerationId: null })
  expect(screen.getByRole('button', { name: 'Generate with AI' }))
    .toBeDisabled()
  expect(screen.getByText(/Save your event details/)).toBeInTheDocument()
  expect(api.request).not.toHaveBeenCalled()
})
it('offers accessibly named mood and direction controls', async () => {
  show({ latestGenerationId: null })
  await userEvent.setup().click(
    screen.getByRole('button', { name: 'Generate with AI' }),
  )
  expect(screen.getByRole('combobox', { name: 'Mood' }))
    .toBeEnabled()
  expect(
    screen.getByRole('textbox', { name: 'Creative direction' }),
  ).toHaveAttribute('maxlength', '300')
})
it('restores the saved creative input on reopen', async () => {
  api.request.mockResolvedValue({
    ...generation,
    input: { mood: 'Community', direction: 'Warm garden light' },
  })
  show()
  await screen.findAllByRole('img')
  expect(screen.getByRole('combobox', { name: 'Mood' }))
    .toHaveValue('Community')
  expect(
    screen.getByRole('textbox', { name: 'Creative direction' }),
  ).toHaveValue('Warm garden light')
})
