import { isValidElement } from 'react'
import { matchRoutes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { RequireOrganizer } from './RequireOrganizer'
import { RequireSession } from './RequireSession'
import { appRouter } from './router'

describe('organizer-only routes', () => {
  it.each([
    ['/organizer-terms', 'OrganizerTermsPage'],
    ['/event-policy', 'EventPolicyPage'],
  ])('keeps the development policy route %s public', (path, componentName) => {
    const matches = matchRoutes(appRouter.routes, path)
    const routeElement = matches?.at(-1)?.route.element

    expect(matches?.at(-1)?.route.path).toBe(path)
    expect(isValidElement(routeElement) && typeof routeElement.type === 'function' && routeElement.type.name).toBe(componentName)
    expect(matches?.some((match) => isValidElement(match.route.element) && (
      match.route.element.type === RequireOrganizer || match.route.element.type === RequireSession
    ))).toBe(false)
  })

  it.each([
    '/organizer/settings/payments',
    '/organizer/events/event-1/tickets',
  ])('keeps %s behind the existing organizer guard', (path) => {
    const matches = matchRoutes(appRouter.routes, path)

    expect(matches?.at(-1)?.route.path).toBe(path.includes('/tickets') ? '/organizer/events/:eventId/tickets' : path)
    expect(matches?.some((match) => (
      isValidElement(match.route.element) && match.route.element.type === RequireOrganizer
    ))).toBe(true)
  })

  it('keeps the anonymous paid-event route outside the session and organizer guards', () => {
    const matches = matchRoutes(appRouter.routes, '/events/eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f')

    expect(matches?.at(-1)?.route.path).toBe('/events/:eventId')
    expect(matches?.some((match) => isValidElement(match.route.element) && (
      match.route.element.type === RequireOrganizer || match.route.element.type === RequireSession
    ))).toBe(false)
  })

  it('keeps guest Checkout anonymous and requires the event route parameter', () => {
    const matches = matchRoutes(appRouter.routes, '/events/eb0fd9d5-d7d5-45dd-a99f-0c8a191bdc6f/checkout')

    expect(matches?.at(-1)?.route.path).toBe('/events/:eventId/checkout')
    expect(matches?.some((match) => isValidElement(match.route.element) && (
      match.route.element.type === RequireOrganizer || match.route.element.type === RequireSession
    ))).toBe(false)
  })

  it('keeps bearer order confirmation anonymous and requires the route token', () => {
    const matches = matchRoutes(appRouter.routes, '/orders/tzGJcJWwoS-3IzLlK9cZV3QHHbC6-vv2d3a-Kl3nHng')

    expect(matches?.at(-1)?.route.path).toBe('/orders/:confirmationToken')
    expect(matches?.some((match) => isValidElement(match.route.element) && (
      match.route.element.type === RequireOrganizer || match.route.element.type === RequireSession
    ))).toBe(false)
  })
})
