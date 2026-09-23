import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
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
      status: 'authenticated',
      user: { id: 'owner' },
      identityVersion: 1,
    }),
  }),
)
vi.mock('../auth/SignOutProvider', () => ({ useOptionalSignOut: () => null }))
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
  api.readEditor.mockResolvedValue(value)
  api.readPreview.mockResolvedValue({ featured: null, events: [] })
  api.saveStorefront.mockImplementation(async (input) => ({
    ...value,
    ...input,
  }))
  api.publishStorefront.mockResolvedValue({ ...value, status: 'published' })
})
function page() {
  render(
    <QueryClientProvider
      client={new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })}
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
