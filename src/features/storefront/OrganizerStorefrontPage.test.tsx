import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ readStorefront: vi.fn() }))
vi.mock('./storefront.api', () => ({ ...api, eventFlyerUrl: (id: string) => `/images/${id}` }))
vi.mock('./storefront.attribution', () => ({ visitStorefront: vi.fn(), startStorefrontTransaction: vi.fn() }))
import { OrganizerStorefrontPage } from './OrganizerStorefrontPage'
const document = { identity: { handle: 'night-sessions', name: 'Night Sessions', bio: 'Music', city: 'Oakland', logoId: null, coverId: null, accent: null, links: {}, websiteUrl: null }, featured: null, events: [], nextCursor: null, serverNow: '2026-09-25T00:00:00Z', merch: [], storeUrl: null }
function page() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/night-sessions']}><Routes><Route path='/:organizerHandle' element={<OrganizerStorefrontPage />} /></Routes></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => { vi.clearAllMocks(); api.readStorefront.mockResolvedValue(document) })
it('shows loading while the public contract is pending', () => {
  api.readStorefront.mockReturnValue(new Promise(() => undefined))
  page()
  expect(screen.getByRole('status')).toHaveTextContent('Loading storefront…')
})
it('keeps an empty published identity visible', async () => {
  page()
  expect(await screen.findByRole('heading', { name: /^Night Sessions$/ })).toBeVisible()
  expect(screen.getByText('No upcoming events right now.')).toBeVisible()
  expect(api.readStorefront).toHaveBeenCalledWith('night-sessions', null)
})
it('uses not found only for a successful null result', async () => {
  api.readStorefront.mockResolvedValue(null)
  page()
  expect(await screen.findByRole('heading', { name: 'Storefront not found' })).toBeVisible()
})
it('retries infrastructure failure without exposing diagnostics or a false 404', async () => {
  api.readStorefront.mockRejectedValueOnce(new Error('PGRST202 raw diagnostic'))
  page()
  expect(await screen.findByRole('alert')).toHaveTextContent('Storefront could not load.')
  expect(screen.queryByText('Storefront not found')).not.toBeInTheDocument()
  expect(screen.queryByText(/PGRST202/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('heading', { name: /^Night Sessions$/ })).toBeVisible()
})
