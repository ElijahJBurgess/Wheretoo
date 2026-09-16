import { render, screen } from '@testing-library/react'
import { createMemoryRouter, matchRoutes, RouterProvider } from 'react-router-dom'
import { expect, it } from 'vitest'
import { createAppRoutes } from '../../app/router/router'
const Blank = () => null
const runtime = { TicketCollectionRoute: Blank, OrganizerDashboardRoute: Blank, OrganizerScannerRoute: Blank, developmentRoutes: [] }

it('attaches anonymous discovery once while preserving organizer and auth boundaries', () => {
  const routes = createAppRoutes(runtime)
  expect(routes.filter(route => route.path === '/discover')).toHaveLength(1)
  expect(matchRoutes(routes, '/discover')?.map(match => match.route.id)).not.toContain('session-shell')
  expect(matchRoutes(routes, '/organizer/events')?.map(match => match.route.id)).toContain('require-organizer')
  for (const path of ['/auth/sign-in', '/auth/sign-up', '/organizer/setup', '/events/event-a/rsvp', '/events/event-a/tickets']) expect(matchRoutes(routes, path)).not.toBeNull()
})

it('redirects root to a clean public path, dropping untrusted query and hash', async () => {
  const routes = createAppRoutes(runtime).map(route => route.path === '/discover' ? { path: '/discover', element: <h1>Discovery test entry</h1> } : route)
  const router = createMemoryRouter(routes, { initialEntries: ['/?ticket=private&returnTo=https://evil.test#private-token'] })
  render(<RouterProvider router={router} />)
  expect(await screen.findByText('Discovery test entry')).toBeVisible()
  expect(router.state.location.pathname).toBe('/discover')
  expect(router.state.location.search).toBe('')
  expect(router.state.location.hash).toBe('')
})

it('retains validated public filters in root bookmarks while removing all other data', async () => {
  const routes = createAppRoutes(runtime).map(route => route.path === '/discover' ? { path: '/discover', element: <h1>Filtered discovery entry</h1> } : route)
  const router = createMemoryRouter(routes, { initialEntries: ['/?when=today&category=music&price=free&email=discarded#discarded'] })
  render(<RouterProvider router={router} />)
  await screen.findByText('Filtered discovery entry')
  expect(router.state.location.pathname + router.state.location.search).toBe('/discover?when=today&category=music&price=free')
  expect(router.state.location.hash).toBe('')
})
