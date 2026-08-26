import { isValidElement } from 'react'
import { matchRoutes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { RequireOrganizer } from './RequireOrganizer'
import { appRouter } from './router'

describe('organizer-only routes', () => {
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
})
