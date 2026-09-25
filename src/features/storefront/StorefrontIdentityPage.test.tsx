import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it } from 'vitest'
import { StorefrontIdentityPage } from './StorefrontIdentityPage'
it('redirects an old identity bookmark to Profile without a fourth step', async () => {
 render(<MemoryRouter initialEntries={['/organizer/setup/identity']}><Routes><Route path='/organizer/setup/identity' element={<StorefrontIdentityPage />} /><Route path='/organizer/setup' element={<p>Organizer Profile destination</p>} /></Routes></MemoryRouter>)
 expect(await screen.findByText('Organizer Profile destination')).toBeInTheDocument()
})
