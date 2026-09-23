import { describe, expect, it } from 'vitest'
import {
  isValidHandle,
  normalizeHandle,
  reservedHandles,
} from './storefront.handle'
import { createAppRoutes } from '../../app/router/router'
import type { TicketExperienceRuntime } from '../ticket-experience/runtime/runtime.types'
import type { RouteObject } from 'react-router-dom'
describe('permanent handles', () => {
  it('normalizes without changing internal spelling', () =>
    expect(normalizeHandle('  DJ-Marcus ')).toBe('dj-marcus'))
  it.each(['abc', 'dj-marcus', 'a1b', 'a'.repeat(30)])(
    'accepts %s',
    (value) => expect(isValidHandle(value)).toBe(true),
  )
  it.each([
    'ab',
    'a'.repeat(31),
    'a--b',
    '-abc',
    'abc-',
    'a_b',
    'a.b',
    'a/b',
    'DJ-Marcus',
    'café',
    'auth',
    'events',
    'discover',
    'organizer',
    'api',
    'tickets',
    '__dev',
  ])('rejects %s', (value) => expect(isValidHandle(value)).toBe(false))
  it('reserves every static root route', () => {
    const routes = createAppRoutes(
      { developmentRoutes: [] } as unknown as TicketExperienceRuntime,
    )
    function check(items: RouteObject[]) {
      for (const route of items) {
        const root = route.path?.match(/^\/([a-z][a-z-]*)/u)?.[1]
        if (root) expect(reservedHandles).toContain(root)
        if (route.children) check(route.children)
      }
    }
    check(routes)
  })
})
