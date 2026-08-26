import { isValidElement } from 'react'
import { matchRoutes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { RequireOrganizer } from './RequireOrganizer'
import { appRouter } from './router'

describe('organizer payment route', () => {
  it('keeps payment setup behind the existing organizer guard', () => {
    const matches = matchRoutes(appRouter.routes, '/organizer/settings/payments')

    expect(matches?.at(-1)?.route.path).toBe('/organizer/settings/payments')
    expect(matches?.some((match) => (
      isValidElement(match.route.element) && match.route.element.type === RequireOrganizer
    ))).toBe(true)
  })
})
