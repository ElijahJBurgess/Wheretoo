import { QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
vi.mock('../../lib/supabase/client', () => ({ supabase: {} }))
import { adoptEventChangeCache } from './eventChanges.cache'
import { testContext } from './eventChanges.fixtures'
it('adopts atomic owned row and requirements while invalidating list, policy, review and public handoffs', () => {
 const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30000 } } })
 const context = testContext()
 const keys = [['events', 'owned', 'organizer-1'], ['moderation', 'agreement', 'organizer-1', 'event-1'], ['moderation', 'review', 'organizer-1', 'event-1'], ['public-event', 'event-1']]
 for (const key of keys) client.setQueryData(key, { old: true })
 adoptEventChangeCache(client, context)
 expect(client.getQueryData(['events', 'detail', 'organizer-1', 'event-1'])).toEqual(context.event)
 expect(client.getQueryData(['moderation', 'requirements', 'organizer-1', 'event-1'])).toEqual(context.requirements)
 for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
})
