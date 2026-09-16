import { render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }))
vi.mock('./SessionProvider', () => ({ useSession, SessionProvider: ({ children }: PropsWithChildren) => children }))
import { CheckEmailPage } from './CheckEmailPage'
function page() {
  return <MemoryRouter initialEntries={['/auth/check-email']}><Routes>
    <Route path="/auth/check-email" element={<CheckEmailPage />} />
    <Route path="/organizer/setup" element={<p>setup destination</p>} />
  </Routes></MemoryRouter>
}
describe('CheckEmailPage', () => {
  it('keeps confirmation guidance until Supabase establishes a session, then continues setup', async () => {
    useSession.mockReturnValue({ status: 'anonymous' })
    const view = render(page())
    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/sign-in')
    useSession.mockReturnValue({ status: 'authenticated' })
    view.rerender(page())
    expect(await screen.findByText('setup destination')).toBeInTheDocument()
  })
})
