import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => ({ status: 'authenticated', pending: false }))
const api = vi.hoisted(() => ({
  readEditor: vi.fn(),
  readPreview: vi.fn(),
  saveStorefront: vi.fn(),
  publishStorefront: vi.fn(),
}))
vi.mock('./storefront.editor.api', () => api)
vi.mock(
  '../auth/SessionProvider',
  () => ({
    useSession: () => ({
      status: auth.status,
      user: { id: 'owner' },
      identityVersion: 1,
    }),
  }),
)
vi.mock('../auth/SignOutProvider', () => ({ useOptionalSignOut: () => ({ pending: auth.pending }) }))
vi.mock(
  '../organizer-settings/UnsavedSettingsGuard',
  () => ({ UnsavedSettingsGuard: () => null }),
)
vi.mock('./StorefrontInsights', () => ({ StorefrontInsights: () => null }))
vi.mock('./StorefrontMedia', () => ({ StorefrontMedia: () => null }))
import { OrganizerStorefrontEditorPage } from './OrganizerStorefrontEditorPage'
const value = {
  name: 'Owner Name',
  bio: 'Our events',
  city: 'Oakland',
  websiteUrl: null,
  logoId: null,
  coverId: null,
  accent: null,
  links: {},
  featuredEventId: null,
  handle: 'owner-name',
  status: 'draft',
  updatedAt: '2026-09-23T00:00:00Z',
  merch: [],
  storeUrl: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  auth.status = 'authenticated'
  auth.pending = false
  api.readEditor.mockResolvedValue(value)
  api.readPreview.mockResolvedValue({ featured: null, events: [] })
  api.saveStorefront.mockImplementation(async (input) => ({
    ...value,
    ...input,
  }))
  api.publishStorefront.mockResolvedValue({ ...value, status: 'published' })
})
function page(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider
      client={client}
    >
      <MemoryRouter>
        <OrganizerStorefrontEditorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
it('shows immutable handle and only approved social controls', async () => {
  page()
  await screen.findByLabelText('Display name')
  expect(screen.getByText(/@owner-name/)).toBeInTheDocument()
  expect(screen.getByLabelText('Instagram')).toBeInTheDocument()
  expect(screen.getByLabelText('TikTok')).toBeInTheDocument()
  expect(screen.queryByLabelText('Facebook')).not.toBeInTheDocument()
})
it('preserves draft when optimistic save conflicts', async () => {
  api.saveStorefront.mockRejectedValue(
    new Error('Your storefront changed elsewhere.'),
  )
  page()
  await screen.findByLabelText('Short description')
  await userEvent.clear(screen.getByLabelText('Short description'))
  await userEvent.type(
    screen.getByLabelText('Short description'),
    'Unsaved description',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save storefront' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'changed elsewhere',
  )
  expect(screen.getByLabelText('Short description')).toHaveValue(
    'Unsaved description',
  )
})
it('does not allow publication of unsaved changes', async () => {
  page()
  await screen.findByLabelText('Display name')
  await userEvent.type(screen.getByLabelText('Display name'), ' changed')
  expect(screen.getByRole('button', { name: 'Publish storefront' }))
    .toBeDisabled()
  expect(screen.getByText(/temporarily disappear/)).toBeInTheDocument()
})
it('publishes only through the owner RPC', async () => {
  page()
  await screen.findByLabelText('Display name')
  await userEvent.click(
    screen.getByRole('button', { name: 'Publish storefront' }),
  )
  await waitFor(() =>
    expect(api.publishStorefront).toHaveBeenCalledWith(
      true,
      value.updatedAt,
      'owner',
      expect.any(Function),
    )
  )
  expect(await screen.findByText('Storefront published.')).toBeInTheDocument()
})
it('protects unsaved merch from publishing and upload cleanup', async () => {
  page()
  await screen.findByLabelText('Visit Store URL (optional)')
  await userEvent.type(
    screen.getByLabelText('Visit Store URL (optional)'),
    'https://shop.example.org',
  )
  expect(screen.getByRole('button', { name: 'Publish storefront' }))
    .toBeDisabled()
  expect(screen.getByRole('button', { name: 'Clear unused uploads' }))
    .toBeDisabled()
})

it('waits for fresh canonical settings before mounting a cached editor', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  client.setQueryData(['organizer-settings', 'storefront', 'owner'], { ...value, name: 'Old cached name' })
  let resolve!: (result: typeof value) => void
  api.readEditor.mockReturnValue(new Promise(done => { resolve = done }))
  page(client)
  expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
  await act(async () => resolve({ ...value, name: 'Fresh profile name' }))
  expect(await screen.findByLabelText('Display name')).toHaveValue('Fresh profile name')
})
it('retries a failed load without exposing diagnostics', async () => {
  api.readEditor.mockRejectedValueOnce(new Error('PGRST202 private diagnostics'))
  page()
  expect(await screen.findByRole('alert')).toHaveTextContent('Storefront settings could not load.')
  expect(screen.queryByText(/PGRST202/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByLabelText('Display name')).toHaveValue(value.name)
})
it('links a missing handle to the existing profile completion', async () => {
  api.readEditor.mockResolvedValue({ ...value, handle: null })
  page()
  expect(await screen.findByRole('link', { name: 'Complete your organizer profile' })).toHaveAttribute('href', '/organizer/settings/profile')
  expect(screen.queryByRole('link', { name: 'View public storefront' })).not.toBeInTheDocument()
})
it('builds the public link only from the saved published handle', async () => {
  api.readEditor.mockResolvedValue({ ...value, status: 'published' })
  page()
  expect(await screen.findByRole('link', { name: 'View public storefront' })).toHaveAttribute('href', '/owner-name')
  await userEvent.type(screen.getByLabelText('Display name'), ' draft')
  expect(screen.getByRole('link', { name: 'View public storefront' })).toHaveAttribute('href', '/owner-name')
})
it('shows successful empty eligible events separately from a failure', async () => {
  page()
  expect(await screen.findByText('No eligible public events yet.')).toBeInTheDocument()
})
it('discards private settings arriving after sign-out', async () => {
  let resolve!: (result: typeof value) => void
  api.readEditor.mockReturnValue(new Promise(done => { resolve = done }))
  const client = new QueryClient()
  const view = page(client)
  auth.status = 'anonymous'
  view.rerender(<QueryClientProvider client={client}><MemoryRouter><OrganizerStorefrontEditorPage /></MemoryRouter></QueryClientProvider>)
  await act(async () => resolve(value))
  expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
  expect(screen.queryByText(/owner-name/)).not.toBeInTheDocument()
})
