import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ getOrganizer: vi.fn(), readIdentity: vi.fn(), saveProfile: vi.fn(), confirmIdentity: vi.fn(), handleAvailable: vi.fn(), uploadOrganizerMedia: vi.fn(), clearUnusedOrganizerMedia: vi.fn(), session: { current: { status: 'authenticated', user: { id: 'a', user_metadata: { full_name: 'New owner' } }, identityVersion: 1 } } }))
vi.mock('../auth/SessionProvider', () => ({ useSession: () => api.session.current }))
vi.mock('./organizer.api', () => ({ getOrganizer: api.getOrganizer }))
vi.mock('./profile.api', () => ({ saveProfile: api.saveProfile }))
vi.mock('../storefront/storefront.identity.api', () => ({ ...api, organizerMediaUrl: () => '' }))
vi.mock('../storefront/StorefrontMedia', () => ({ StorefrontMedia: ({ id, alt }: { id: string; alt: string }) => <img alt={alt} data-media-id={id} /> }))
import { OrganizerProfileEditor } from './OrganizerProfileEditor'
import { OrganizerSetupPage } from './OrganizerSetupPage'
import { invalidateIdentityLifetime } from '../auth/identityLifetime'
const row = { id: 'a', display_name: 'Saved organizer', organizer_type: 'Venue', bio: null, website_url: null, base_city: null, updated_at: '2026-09-24T00:00:00Z', onboarding_completed_at: null }
function setup() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 const tree = <QueryClientProvider client={client}><MemoryRouter initialEntries={['/organizer/setup']}><Routes><Route path='/organizer/setup' element={<OrganizerSetupPage />} /><Route path='/organizer/settings/payments' element={<p>Payout destination</p>} /><Route path='/discover' element={<p>Discovery destination</p>} /><Route path='/organizer/events' element={<p>Events destination</p>} /></Routes></MemoryRouter></QueryClientProvider>
 return { client, tree, ...render(tree) }
}
beforeEach(() => { vi.clearAllMocks(); api.session.current = { status: 'authenticated', user: { id: 'a', user_metadata: { full_name: 'New owner' } }, identityVersion: 1 }; api.getOrganizer.mockResolvedValue(row); api.readIdentity.mockResolvedValue({ handle: null, logoId: null, name: row.display_name }); api.handleAvailable.mockResolvedValue(true); api.saveProfile.mockResolvedValue({ updatedAt: '2026-09-24T01:00:00Z' }); api.confirmIdentity.mockResolvedValue({ handle: 'night-assembly' }); api.uploadOrganizerMedia.mockResolvedValue('asset'); api.clearUnusedOrganizerMedia.mockResolvedValue(undefined) })
async function loaded() { await screen.findByLabelText('Permanent handle') }
function chooseHandle() { fireEvent.change(screen.getByLabelText('Permanent handle'), { target: { value: 'Night-Assembly' } }); fireEvent.click(screen.getByRole('checkbox')) }
it('consolidates identity and profile into Step 2 with existing optional values', async () => { setup(); await loaded(); expect(screen.getByLabelText('Organizer / business name')).toHaveValue('Saved organizer'); expect(screen.getByLabelText('Short description')).toHaveValue(''); expect(screen.getByLabelText('Organizer logo / avatar (optional)')).toBeInTheDocument(); expect(screen.getByText('Profile').closest('li')).toHaveAttribute('aria-current', 'step') })
it('first-time profile skips identity read until a row exists', async () => { api.getOrganizer.mockResolvedValue(null); setup(); await loaded(); expect(screen.getByLabelText('Organizer / business name')).toHaveValue('New owner'); expect(api.readIdentity).not.toHaveBeenCalled() })
it('requires permanent confirmation before claiming', async () => { setup(); await loaded(); fireEvent.change(screen.getByLabelText('Permanent handle'), { target: { value: 'night-assembly' } }); fireEvent.click(screen.getByRole('button', { name: 'Continue' })); expect(await screen.findByRole('alert')).toHaveTextContent('confirm'); expect(api.confirmIdentity).not.toHaveBeenCalled() })
it('saves and claims without optional logo before Payouts', async () => { setup(); await loaded(); chooseHandle(); fireEvent.click(screen.getByRole('button', { name: 'Continue' })); await screen.findByText('Payout destination'); expect(api.confirmIdentity).toHaveBeenCalledWith('night-assembly', null, 'a', expect.any(Function)) })
it('Save & leave preserves mutable data and never claims even with confirmation selected', async () => { setup(); await loaded(); chooseHandle(); fireEvent.click(screen.getByRole('button', { name: 'Save & leave' })); await screen.findByText('Discovery destination'); expect(api.saveProfile).toHaveBeenCalled(); expect(api.confirmIdentity).not.toHaveBeenCalled() })
it('completed organizers can revisit Profile with read-only URL', async () => { api.getOrganizer.mockResolvedValue({ ...row, onboarding_completed_at: '2026-09-24' }); api.readIdentity.mockResolvedValue({ handle: 'night-assembly', logoId: 'asset', name: 'Saved organizer' }); setup(); expect(await screen.findByRole('link', { name: /night-assembly/ })).toBeInTheDocument(); expect(screen.queryByLabelText('Permanent handle')).not.toBeInTheDocument(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Continue' })); await screen.findByText('Payout destination'); expect(api.confirmIdentity).not.toHaveBeenCalled() })
it('temporary identity failure has retry and never exposes an empty editing form', async () => { api.readIdentity.mockRejectedValueOnce(new TypeError('Failed to fetch')); setup(); expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch'); expect(screen.queryByLabelText('Permanent handle')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Try again' })); await loaded() })
it.each(['Back', 'Exit setup'])('%s leaves incomplete setup without a guard trap or claim', async name => { setup(); await loaded(); fireEvent.click(screen.getByRole('button', { name })); await screen.findByText('Discovery destination'); expect(api.confirmIdentity).not.toHaveBeenCalled() })
it('invalid handle cannot claim', async () => { setup(); await loaded(); fireEvent.change(screen.getByLabelText('Permanent handle'), { target: { value: 'organizer' } }); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Continue' })); await screen.findByRole('alert'); expect(api.confirmIdentity).not.toHaveBeenCalled() })
it('failed claims retain drafts and uploaded image for retry', async () => { api.confirmIdentity.mockRejectedValueOnce(new Error('That handle was just claimed. Choose another.')); setup(); await loaded(); chooseHandle(); fireEvent.change(screen.getByLabelText('Organizer logo / avatar (optional)'), { target: { files: [new File(['image'], 'logo.png', { type: 'image/png' })] } }); fireEvent.click(screen.getByRole('button', { name: 'Continue' })); await screen.findByText(/just claimed/); expect(screen.getByLabelText('Permanent handle')).toHaveValue('night-assembly'); fireEvent.click(screen.getByRole('button', { name: 'Continue' })); await screen.findByText('Payout destination'); expect(api.uploadOrganizerMedia).toHaveBeenCalledTimes(1) })
it('sign-out during save prevents claim and navigation', async () => { let finish!: (value: { updatedAt: string }) => void; api.saveProfile.mockReturnValue(new Promise(resolve => { finish = resolve })); const view = setup(); await loaded(); chooseHandle(); fireEvent.click(screen.getByRole('button', { name: 'Continue' })); await waitFor(() => expect(api.saveProfile).toHaveBeenCalled()); invalidateIdentityLifetime(view.client); api.session.current = { ...api.session.current, status: 'anonymous' }; view.rerender(<QueryClientProvider client={view.client}><MemoryRouter><OrganizerSetupPage /></MemoryRouter></QueryClientProvider>); await act(async () => finish({ updatedAt: '2026-09-24T02:00:00Z' })); expect(api.confirmIdentity).not.toHaveBeenCalled(); expect(screen.queryByDisplayValue('Saved organizer')).not.toBeInTheDocument() })
it('rejects invalid profile values before any save', async () => { setup(); await loaded(); fireEvent.change(screen.getByLabelText('Organizer / business name'), { target: { value: 'A' } }); fireEvent.change(screen.getByLabelText('Website or social (optional)'), { target: { value: 'not a url' } }); fireEvent.click(screen.getByRole('button', { name: 'Save & leave' })); await screen.findByText('Check the highlighted fields'); expect(screen.getByLabelText('Organizer / business name')).toHaveAttribute('aria-invalid', 'true'); expect(api.saveProfile).not.toHaveBeenCalled() })
it('retains profile fields when saving fails', async () => { api.saveProfile.mockRejectedValueOnce(new Error('Temporary save failure')); setup(); await loaded(); fireEvent.change(screen.getByLabelText('Short description'), { target: { value: 'Keep my draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Save & leave' })); await screen.findByText('Temporary save failure'); expect(screen.getByLabelText('Short description')).toHaveValue('Keep my draft'); fireEvent.click(screen.getByRole('button', { name: 'Save & leave' })); await screen.findByText('Discovery destination') })
it('requires review of a newer saved version before retrying a conflict', async () => { api.saveProfile.mockRejectedValueOnce(new Error('Your profile changed elsewhere. Review the latest saved profile before saving again.')); setup(); await loaded(); fireEvent.click(screen.getByRole('button', { name: 'Save & leave' })); await screen.findByText(/changed elsewhere/); expect(screen.getByRole('button', { name: 'Save & leave' })).toBeDisabled(); api.getOrganizer.mockResolvedValue({ ...row, display_name: 'Other tab name', updated_at: '2026-09-24T02:00:00Z' }); fireEvent.click(screen.getByRole('button', { name: 'Review latest saved profile' })); await screen.findByText('Latest saved profile: Other tab name'); fireEvent.click(screen.getByRole('button', { name: 'Keep my draft for the reviewed version' })); fireEvent.click(screen.getByRole('button', { name: 'Save & leave' })); await screen.findByText('Discovery destination'); expect(api.saveProfile).toHaveBeenLastCalledWith('a', expect.objectContaining({ displayName: 'Saved organizer' }), '2026-09-24T02:00:00Z', null, expect.any(Function)) })
it('does not display a late private load after session generation changes', async () => { let finish!: (value: typeof row) => void; api.getOrganizer.mockReturnValueOnce(new Promise(resolve => { finish = resolve })); const view = setup(); invalidateIdentityLifetime(view.client); api.session.current.identityVersion = 3; api.getOrganizer.mockResolvedValue({ ...row, display_name: 'Fresh session' }); view.rerender(<QueryClientProvider client={view.client}><MemoryRouter><OrganizerSetupPage /></MemoryRouter></QueryClientProvider>); await act(async () => finish(row)); expect(screen.queryByDisplayValue('Saved organizer')).not.toBeInTheDocument() })
it('rejects unsupported logos before upload', async () => { setup(); await loaded(); fireEvent.change(screen.getByLabelText('Organizer logo / avatar (optional)'), { target: { files: [new File(['bad'], 'logo.svg', { type: 'image/svg+xml' })] } }); await screen.findByRole('alert'); expect(api.uploadOrganizerMedia).not.toHaveBeenCalled() })

function settingsPage() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
 const router = createMemoryRouter([{ path: '*', element: <OrganizerProfileEditor settings /> }])
 return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}
it('adopts the complete post-save snapshot before adopting a newer Settings version', async () => {
 settingsPage(); await loaded()
 api.getOrganizer.mockResolvedValue({ ...row, display_name: 'Concurrent name', bio: 'Concurrent bio', updated_at: '2026-09-24T03:00:00Z' })
 api.readIdentity.mockResolvedValue({ handle: null, logoId: 'new-logo', name: 'Concurrent name' })
 fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
 await screen.findByText('Organizer profile saved.')
 expect(screen.getByLabelText('Organizer / business name')).toHaveValue('Concurrent name')
 expect(screen.getByLabelText('Short description')).toHaveValue('Concurrent bio')
 expect(screen.getByRole('img', { name: 'Organizer logo' })).toHaveAttribute('data-media-id', 'new-logo')
})
it('keeps a concurrently saved logo when only the local bio was edited', async () => {
 api.saveProfile.mockRejectedValueOnce(new Error('Your profile changed elsewhere.'))
 settingsPage(); await loaded()
 fireEvent.change(screen.getByLabelText('Short description'), { target: { value: 'Local bio' } })
 fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
 await screen.findByText(/changed elsewhere/)
 api.getOrganizer.mockResolvedValue({ ...row, updated_at: '2026-09-24T03:00:00Z' })
 api.readIdentity.mockResolvedValue({ handle: null, logoId: 'concurrent-logo', name: row.display_name })
 fireEvent.click(screen.getByRole('button', { name: 'Review latest saved profile' }))
 await screen.findByText(/Latest saved profile:/)
 expect(screen.getByRole('img', { name: 'Latest saved logo' })).toHaveAttribute('data-media-id', 'concurrent-logo')
 fireEvent.click(screen.getByRole('button', { name: 'Keep my draft for the reviewed version' }))
 fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
 await screen.findByText('Organizer profile saved.')
 expect(api.saveProfile).toHaveBeenLastCalledWith('a', expect.objectContaining({ bio: 'Local bio' }), '2026-09-24T03:00:00Z', 'concurrent-logo', expect.any(Function))
})
