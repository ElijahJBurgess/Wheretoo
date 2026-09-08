import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter, matchRoutes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { TicketExperienceRuntime } from '../../features/ticket-experience/runtime/runtime.types'

const supabaseEvaluation = vi.hoisted(() => vi.fn())

vi.mock('../../lib/supabase/client', () => {
  supabaseEvaluation()
  return { supabase: {} }
})

import { developmentTicketExperienceRuntime } from '../../features/ticket-experience/runtime/development'
import {
  NotEnabledRoute,
  productionTicketExperienceRuntime,
} from '../../features/ticket-experience/runtime/production'
import { selectTicketExperienceEntry } from '../../../vite.config'
import { createAppRouter } from './router'

function TicketRoute() {
  return null
}

function ScannerRoute() {
  return null
}

function DashboardRoute() {
  return null
}

const runtime: TicketExperienceRuntime = {
  TicketCollectionRoute: TicketRoute,
  OrganizerScannerRoute: ScannerRoute,
  OrganizerDashboardRoute: DashboardRoute,
  developmentRoutes: [],
}

function matchedIds(path: string) {
  const router = createAppRouter(runtime)
  return matchRoutes(router.routes, path)?.map(({ route }) => route.id) ?? []
}

describe('ticket experience router composition', () => {
  it('does not evaluate the Supabase client when the router module loads', () => {
    expect(supabaseEvaluation).not.toHaveBeenCalled()
  })

  it.each([
    '/tickets/wh_test_collection_paid',
    '/tickets/wh_test_collection_paid/paid-1',
  ])('keeps the bearer-authorized customer route %s anonymous', (path) => {
    const router = createAppRouter(runtime)
    const matches = matchRoutes(router.routes, path)

    const matchedElement = matches?.at(-1)?.route.element
    expect(matchedElement).toMatchObject({ type: TicketRoute })
    expect(matches?.map(({ route }) => route.id)).not.toContain('session-shell')
    expect(matches?.map(({ route }) => route.id)).not.toContain('require-organizer')
  })

  it.each([
    '/organizer/events/event-a/dashboard',
    '/organizer/events/event-a/check-in',
  ])('keeps %s behind session and organizer boundaries', (path) => {
    expect(matchedIds(path)).toEqual(
      expect.arrayContaining(['session-shell', 'require-session', 'organizer-shell', 'require-organizer']),
    )
  })

  it.each([
    '/',
    '/events/event-a',
    '/events/event-a/checkout',
    '/orders/confirmation-bearer',
    '/organizer-terms',
    '/event-policy',
    '/auth/sign-up',
    '/auth/check-email',
    '/auth/sign-in',
  ])('retains the public route %s outside session composition', (path) => {
    expect(matchedIds(path)).not.toContain('session-shell')
  })

  it.each([
    '/organizer/events',
    '/organizer/settings/payments',
    '/organizer/events/new',
    '/organizer/events/event-a/edit',
    '/organizer/events/event-a/preview',
    '/organizer/events/event-a/tickets',
    '/organizer/events/event-a',
  ])('retains the existing organizer route %s behind organizer access', (path) => {
    expect(matchedIds(path)).toContain('require-organizer')
  })

  it('keeps production routes fail-closed and excludes development routes', () => {
    expect(productionTicketExperienceRuntime.OrganizerScannerRoute).not.toBe(NotEnabledRoute)
    expect(productionTicketExperienceRuntime.OrganizerDashboardRoute).toBe(NotEnabledRoute)
    expect(productionTicketExperienceRuntime.developmentRoutes).toEqual([])
  })

  it('registers only fixed development QA route patterns in development composition', () => {
    expect(developmentTicketExperienceRuntime.developmentRoutes.map(({ path }) => path)).toEqual([
      '/__dev/ticket-shells/events/:eventId/dashboard',
      '/__dev/ticket-shells/events/:eventId/check-in',
      '/__dev/ticket-shells/events/:eventId/check-in/:scannerScenario',
      '/__dev/ticket-shells/emails/:template/:scenario',
      '/__dev/ticket-shells/qr/:caseId',
    ])
  })

  it('keeps the authenticated development dashboard inside the organizer main landmark', async () => {
    const Dashboard = developmentTicketExperienceRuntime.OrganizerDashboardRoute
    const router = createMemoryRouter([
      {
        path: '/organizer/events/:eventId/dashboard',
        element: (
          <main className="organizer-layout__main">
            <Dashboard />
          </main>
        ),
      },
    ], { initialEntries: ['/organizer/events/event-a/dashboard'] })
    const view = render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: 'Mission Night Market' })).toBeVisible()
    expect(view.container.querySelectorAll('main')).toHaveLength(1)
  })

  it.each([
    ['/__dev/ticket-shells/events/event-a/dashboard', 'Mission Night Market'],
    ['/__dev/ticket-shells/events/event-a/check-in', 'Camera could not start'],
    ['/__dev/ticket-shells/emails/tickets-ready/free-rsvp', 'Email shell'],
  ])('accepts the fixed development scenario %s', async (path, title) => {
    const router = createMemoryRouter([...developmentTicketExperienceRuntime.developmentRoutes], {
      initialEntries: [path],
    })

    render(<RouterProvider router={router} />)

    expect(await screen.findByText(title)).toBeVisible()
  })

  it.each([
    '/__dev/ticket-shells/events/unknown/dashboard',
    '/__dev/ticket-shells/events/unknown/check-in',
    '/__dev/ticket-shells/emails/unknown/unknown',
  ])('fails closed for the unknown development scenario %s', async (path) => {
    const router = createMemoryRouter([...developmentTicketExperienceRuntime.developmentRoutes], {
      initialEntries: [path],
    })

    render(<RouterProvider router={router} />)

    expect(await screen.findByText('Development scenario unavailable')).toBeVisible()
  })

  it('selects the development entry only while Vite serves the app', () => {
    const html = '<script type="module" src="/src/main.tsx"></script>'

    expect(selectTicketExperienceEntry(html, 'serve')).toContain('/src/main.development.tsx')
    expect(selectTicketExperienceEntry(html, 'build')).toBe(html)
  })
})
