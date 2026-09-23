import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({
  readIdentity: vi.fn(),
  handleAvailable: vi.fn(),
  uploadOrganizerMedia: vi.fn(),
  confirmIdentity: vi.fn(),
}))
vi.mock('./storefront.identity.api', () => api)
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
import { StorefrontIdentityPage } from './StorefrontIdentityPage'
function page() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Routes>
          <Route path='/' element={<StorefrontIdentityPage />} />
          <Route
            path='/organizer/settings/payments'
            element={<p>Payments decision</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  api.readIdentity.mockResolvedValue({
    handle: null,
    logoId: null,
    name: 'Owner',
  })
  api.handleAvailable.mockResolvedValue(true)
  api.uploadOrganizerMedia.mockResolvedValue('asset')
  api.confirmIdentity.mockResolvedValue({ handle: 'dj-marcus' })
})
it('requires identity image and explicit permanence confirmation', async () => {
  page()
  await screen.findByLabelText('Permanent handle')
  await userEvent.type(screen.getByLabelText('Permanent handle'), 'dj-marcus')
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm identity and continue' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('add your logo')
  expect(api.confirmIdentity).not.toHaveBeenCalled()
})
it('uploads logo then atomically confirms before payments', async () => {
  page()
  await screen.findByLabelText('Permanent handle')
  await userEvent.type(screen.getByLabelText('Permanent handle'), 'dj-marcus')
  await userEvent.upload(
    screen.getByLabelText('Organizer logo / avatar'),
    new File(['test'], 'logo.png', { type: 'image/png' }),
  )
  await userEvent.click(screen.getByRole('checkbox'))
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm identity and continue' }),
  )
  await screen.findByText('Payments decision')
  expect(api.confirmIdentity).toHaveBeenCalledWith(
    'dj-marcus',
    'asset',
    'owner',
  )
})
it('retains the image after a raced claim is rejected', async () => {
  api.confirmIdentity.mockRejectedValue(
    new Error('That handle was just claimed. Choose another.'),
  )
  page()
  await screen.findByLabelText('Permanent handle')
  await userEvent.type(screen.getByLabelText('Permanent handle'), 'dj-marcus')
  await userEvent.upload(
    screen.getByLabelText('Organizer logo / avatar'),
    new File(['test'], 'logo.png', { type: 'image/png' }),
  )
  await userEvent.click(screen.getByRole('checkbox'))
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm identity and continue' }),
  )
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('just claimed')
  )
  expect(screen.getByLabelText('Permanent handle')).toHaveValue('dj-marcus')
})
