import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('./production', () => ({ productionTicketExperienceRuntime: { TicketCollectionRoute: () => <h1>Real accountless collection</h1> } }))
import { developmentTicketExperienceRuntime } from './development'
afterEach(cleanup)
function open(bearer: string) {
  const Collection = developmentTicketExperienceRuntime.TicketCollectionRoute
  return render(<MemoryRouter initialEntries={[`/tickets/${bearer}`]}><Routes><Route path="/tickets/:collectionBearer" element={<Collection />} /></Routes></MemoryRouter>)
}
it('delegates a real bearer to the production accountless collection route', () => {
  open('A'.repeat(43))
  expect(screen.getByRole('heading', { name: 'Real accountless collection' })).toBeVisible()
})
it('retains existing named synthetic previews', async () => {
  open('wh_test_collection_refunded')
  expect(screen.queryByText('Real accountless collection')).toBeNull()
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Refunded'))
  expect(screen.queryByRole('img', { name: 'Admission QR code' })).toBeNull()
})
