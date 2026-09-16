import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { DiscoveryPreview } from './DiscoveryPreview'

it('switches among isolated visual states without requesting external data', async () => {
  render(<MemoryRouter><DiscoveryPreview /></MemoryRouter>)
  expect(screen.getByText('Coming up')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Malformed mix' }))
  expect(screen.getByText('2 events could not be shown.')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Rate limited' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Try again in 45 seconds')
  await userEvent.click(screen.getByRole('button', { name: 'Unavailable' }))
  expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load events.')
  await userEvent.click(screen.getByRole('button', { name: 'Malformed response' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Events are temporarily unavailable.')
  await userEvent.click(screen.getByRole('button', { name: 'Append error' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load more events.')
})

it('opens the isolated buyer preview without making a request', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  const router = createMemoryRouter([
    { path: '/preview/discovery', element: <DiscoveryPreview /> },
    { path: '/preview/event-page', element: <h1>Isolated buyer preview</h1> },
  ], { initialEntries: ['/preview/discovery'] })
  render(<RouterProvider router={router} />)

  await userEvent.click(screen.getByRole('link', { name: 'View Sunset Rooftop Sessions' }))

  expect(await screen.findByRole('heading', { name: 'Isolated buyer preview' })).toBeVisible()
  expect(router.state.location.pathname).toBe('/preview/event-page')
  expect(router.state.location.state).toEqual({ discoverySearch: '' })
  expect(fetchSpy).not.toHaveBeenCalled()
  fetchSpy.mockRestore()
})

it('uses the current Friday-to-Monday weekend at the fixed Sunday preview clock', async () => {
  render(<MemoryRouter><DiscoveryPreview /></MemoryRouter>)
  await userEvent.click(screen.getByRole('button', { name: 'This weekend' }))
  expect(screen.getByText('Sunset Rooftop Sessions')).toBeVisible()
  expect(screen.getByText('Taco Social')).toBeVisible()
  expect(screen.queryByText('Lake Merritt Morning Miles')).not.toBeInTheDocument()
})

it('recovers real preview artwork after switching away from a failed image URL', async () => {
  const view = render(<MemoryRouter><DiscoveryPreview /></MemoryRouter>)
  await userEvent.click(screen.getByRole('button', { name: 'Image failure' }))
  const broken = view.container.querySelector('.discovery-hero img')
  expect(broken).not.toBeNull()
  fireEvent.error(broken!)
  expect(view.container.querySelector('.discovery-hero img')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Ready' }))
  expect(view.container.querySelector('.discovery-hero img')).not.toBeNull()
})
