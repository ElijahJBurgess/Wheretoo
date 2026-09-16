import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { getOrganizer, saveSettingsProfile, session } = vi.hoisted(() => ({ getOrganizer: vi.fn(), saveSettingsProfile: vi.fn(), session: { current: { status: 'authenticated', user: { id: 'a' }, identityVersion: 1 } } }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => session.current }))
vi.mock('../organizers/organizer.api', () => ({ getOrganizer }))
vi.mock('./settings.profile.api', async original => ({ ...await original<typeof import('./settings.profile.api')>(), saveSettingsProfile }))
import { OrganizerProfilePage } from './OrganizerProfilePage'
import { SettingsProfileError } from './settings.profile.api'
import { setAuthenticatedIdentity } from '../auth/identityLifetime'
const row = { display_name: 'Public organizer', bio: 'Saved bio', updated_at: '2026-09-01T00:00:00Z' }
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  setAuthenticatedIdentity(client, 'a')
  const router = createMemoryRouter([{ path: '*', element: <OrganizerProfilePage /> }])
  const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return { client, ...view }
}
describe('Organizer Profile editor', () => {
  beforeEach(() => { vi.clearAllMocks(); session.current = { status: 'authenticated', user: { id: 'a' }, identityVersion: 1 }; getOrganizer.mockResolvedValue(row) })
  it('retains failed draft and requires explicit latest-version review after conflict', async () => {
    saveSettingsProfile.mockRejectedValueOnce(new SettingsProfileError('conflict')).mockResolvedValueOnce({ displayName: 'My draft', bio: 'Saved bio', updatedAt: '2026-09-12T00:00:00Z' })
    setup()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Organizer display name' }), { target: { value: 'My draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('changed elsewhere')
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled()
    getOrganizer.mockResolvedValue({ ...row, display_name: 'Their version', updated_at: '2026-09-10T00:00:00Z' })
    fireEvent.click(screen.getByRole('button', { name: 'Review latest saved profile' }))
    expect(await screen.findByText('Their version')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Organizer display name' })).toHaveValue('My draft')
    fireEvent.click(screen.getByRole('button', { name: 'Keep my draft for the reviewed version' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByText('Organizer profile saved.')).toBeInTheDocument()
    expect(saveSettingsProfile).toHaveBeenLastCalledWith('a', { displayName: 'My draft', bio: 'Saved bio', expectedUpdatedAt: '2026-09-10T00:00:00Z' }, expect.any(Function))
  })
  it('discards a deferred profile save result after identity lifetime changes', async () => {
    let finish!: (value: { displayName: string; bio: string; updatedAt: string }) => void
    saveSettingsProfile.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const { client, rerender } = setup()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Organizer display name' }), { target: { value: 'Old identity draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    setAuthenticatedIdentity(client, 'b'); setAuthenticatedIdentity(client, 'a'); session.current.identityVersion = 3
    const router = createMemoryRouter([{ path: '*', element: <OrganizerProfilePage /> }])
    rerender(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
    await act(async () => finish({ displayName: 'Old identity draft', bio: '', updatedAt: '2026-09-12T00:00:00Z' }))
    expect(screen.queryByText('Organizer profile saved.')).not.toBeInTheDocument()
    expect(await screen.findByRole('textbox', { name: 'Organizer display name' })).toHaveValue('Public organizer')
    expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.state.data))).not.toContain('Old identity draft')
  })
})
