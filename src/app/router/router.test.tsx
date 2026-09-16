import { act, render, screen } from '@testing-library/react'
import { Outlet, RouterProvider, createMemoryRouter, matchRoutes } from 'react-router-dom'
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
import { createAppRouter, createAppRoutes } from './router'

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
    '/organizer/events/event-a/orders',
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
    '/tickets/recover',
    '/ticket-access',
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
    expect(productionTicketExperienceRuntime.OrganizerDashboardRoute).not.toBe(NotEnabledRoute)
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

  it('uses the same real organizer operations in development and production', () => {
    expect(developmentTicketExperienceRuntime.OrganizerDashboardRoute).toBe(productionTicketExperienceRuntime.OrganizerDashboardRoute)
    expect(developmentTicketExperienceRuntime.OrganizerScannerRoute).toBe(productionTicketExperienceRuntime.OrganizerScannerRoute)
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

it('matches ticket recovery as a static route before the private bearer collection', () => {
  const router = createAppRouter(runtime)
  expect(matchRoutes(router.routes, '/tickets/recover')?.at(-1)?.route.path).toBe('/tickets/recover')
  router.dispose()
})


it('attaches refund history once and preserves all payment, RSVP and delivery routes', () => {
  const router = createAppRouter(runtime)
  const paths = router.routes.map(route => route.path).filter(Boolean)
  expect(new Set(paths).size).toBe(paths.length)
  for (const path of ['/refund-details', '/tickets/recover', '/ticket-access', '/events/:eventId/rsvp', '/rsvp/:collectionBearer', '/events/:eventId/checkout', '/orders/:confirmationToken', '/tickets/:collectionBearer', '/tickets/:collectionBearer/:ticketSelector']) {
    expect(paths.filter(value => value === path)).toHaveLength(1)
  }
  expect(matchRoutes(router.routes, '/refund-details')?.at(-1)?.route.lazy).toBeTypeOf('function')
  router.dispose()
})

it('Spec10 and Spec11 have one unshadowed route each alongside original admission and financial routes', () => {
 const router = createAppRouter(runtime)
 const event = '11111111-1111-4111-8111-111111111111'
 for (const path of [`/organizer/events/${event}/changes`, `/organizer/events/${event}/cancellation`, '/event-status', '/organizer/settings', ...['account','profile','payments','help','actions'].map(part=>'/organizer/settings/'+part), `/organizer/events/${event}/check-in/scan`, '/tickets/recover', '/ticket-access', '/refund-details', '/tickets/rsvp_free_original', '/tickets/paid_original']) {
   expect(matchRoutes(router.routes,path)?.at(-1)).toBeDefined()
 }
 const paths: string[] = []
 function visit(routes: typeof router.routes, parent = '') {
  for (const route of routes) {
   const path = route.path?.startsWith('/') ? route.path : route.path ? parent+'/'+route.path : parent
   if (route.path) paths.push(path)
   if (route.children) visit(route.children,path)
  }
 }
 visit(router.routes)
 expect(new Set(paths).size).toBe(paths.length)
 router.dispose()
})

describe('sanitized route fallbacks', () => {
  it('shows a sanitized loading state while a lazy route module is pending', async () => {
    let resolveModule!: (module: { Component: () => React.ReactNode }) => void
    const pendingModule = new Promise<{ Component: () => React.ReactNode }>(resolve => {
      resolveModule = resolve
    })
    const boundaryRuntime: TicketExperienceRuntime = {
      ...runtime,
      developmentRoutes: [{ path: '/__test/slow-lazy-route', lazy: () => pendingModule }],
    }
    const router = createMemoryRouter(createAppRoutes(boundaryRuntime), {
      initialEntries: ['/__test/slow-lazy-route'],
    })

    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: 'Loading page' })).toBeVisible()

    await act(async () => {
      resolveModule({ Component: () => <h1>Lazy route ready</h1> })
      await pendingModule
    })
    expect(await screen.findByRole('heading', { name: 'Lazy route ready' })).toBeVisible()
  })

  it.each(['/events/checkout', '/events//checkout'])(
    'routes the missing checkout identifier %s to checkout unavailable handling',
    path => {
    const router = createAppRouter(runtime)

    expect(matchRoutes(router.routes, path)?.at(-1)?.route.path).toBe(path)
    router.dispose()
    },
  )

  it('offers a real public destination for an unmatched route without echoing the URL', async () => {
    const privatePath = '/missing/bearer-secret-value'
    const router = createMemoryRouter(createAppRoutes(runtime), { initialEntries: [privatePath] })

    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/auth/sign-in')
    expect(document.body).not.toHaveTextContent(privatePath)
    expect(document.body).not.toHaveTextContent('bearer-secret-value')
  })

  it('sanitizes a route render exception and keeps its parent route shell mounted', async () => {
    function Shell() {
      return <div data-testid="retained-shell"><Outlet /></div>
    }
    function BrokenRoute(): never {
      throw new Error('render failed with bearer-secret-value')
    }
    const boundaryRuntime: TicketExperienceRuntime = {
      ...runtime,
      developmentRoutes: [{ path: '/__test/render-failure', Component: BrokenRoute }],
    }
    const routes = createAppRoutes(boundaryRuntime)
    const testRoute = routes.find(route => route.path === '/__test/render-failure')!
    const router = createMemoryRouter([
      { Component: Shell, children: [testRoute] },
    ], { initialEntries: ['/__test/render-failure'] })

    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: 'Page unavailable' })).toBeVisible()
    expect(screen.getByTestId('retained-shell')).toBeVisible()
    expect(document.body).not.toHaveTextContent('bearer-secret-value')
  })

  it('sanitizes a rejected lazy route module', async () => {
    const boundaryRuntime: TicketExperienceRuntime = {
      ...runtime,
      developmentRoutes: [{
        path: '/__test/lazy-failure',
        lazy: async () => { throw new Error('chunk URL contains token-secret-value') },
      }],
    }
    const router = createMemoryRouter(createAppRoutes(boundaryRuntime), {
      initialEntries: ['/__test/lazy-failure'],
    })

    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: 'Page unavailable' })).toBeVisible()
    expect(document.body).not.toHaveTextContent('token-secret-value')
  })
})
