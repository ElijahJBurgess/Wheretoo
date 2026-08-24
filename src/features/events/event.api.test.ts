import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventFormValues, EventRow } from './event.types'

const {
  from,
  rpc,
  select,
  firstEq,
  secondEq,
  order,
  maybeSingle,
  insert,
  update,
  mutationSelect,
  single,
} = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  firstEq: vi.fn(),
  secondEq: vi.fn(),
  order: vi.fn(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  mutationSelect: vi.fn(),
  single: vi.fn(),
}))

vi.mock('../../lib/supabase/client', () => ({ supabase: { from, rpc } }))

import {
  eventRowToFormValues,
  getOwnedEvent,
  listOwnedEvents,
  publishEvent,
  saveEventDraft,
} from './event.api'
import { eventKeys, useOwnedEvent, usePublishEvent, useSaveEventDraft } from './event.queries'

const event: EventRow = {
  id: 'event-returned',
  organizer_id: 'organizer-1',
  status: 'draft',
  moderation_status: 'clear',
  title: 'Night Market',
  description: 'An evening market featuring local food and neighborhood makers.',
  category: 'community',
  starts_at: '2026-08-25T02:00:00.000Z',
  ends_at: '2026-08-25T05:00:00.000Z',
  timezone: 'America/Los_Angeles',
  venue_name: 'Civic Center Plaza',
  address_line1: '1 Dr Carlton B Goodlett Place',
  address_line2: null,
  city: 'San Francisco',
  region: 'CA',
  postal_code: '94102',
  country_code: 'US',
  mapbox_feature_id: 'address.verified',
  latitude: 37.7793,
  longitude: -122.4193,
  location: 'computed geography',
  admission_type: 'free',
  capacity: 250,
  artwork_path: null,
  animation_preset: 'generic',
  published_at: null,
  created_at: '2026-08-24T12:00:00.000Z',
  updated_at: '2026-08-24T12:00:00.000Z',
}

const values: EventFormValues = {
  title: 'Night Market',
  description: 'An evening market featuring local food and neighborhood makers.',
  category: 'community',
  startsAt: '2026-08-24T19:00',
  endsAt: '2026-08-24T22:00',
  timezone: 'America/Los_Angeles',
  venueName: '   ',
  location: {
    mapboxFeatureId: 'address.verified',
    addressLine1: '1 Dr Carlton B Goodlett Place',
    addressLine2: '   ',
    city: 'San Francisco',
    region: 'CA',
    postalCode: '94102',
    countryCode: 'US',
    latitude: 37.7793,
    longitude: -122.4193,
  },
  admissionType: 'free',
  capacity: 250,
}

const forbiddenMutationKeys = [
  'status',
  'moderation_status',
  'published_at',
  'location',
  'artwork_path',
  'animation_preset',
]

function expectSafePayload(payload: Record<string, unknown>) {
  for (const key of forbiddenMutationKeys) {
    expect(payload).not.toHaveProperty(key)
  }
}

describe('owned event API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    select.mockReturnValue({ eq: firstEq })
    firstEq.mockReturnValue({ eq: secondEq, order })
    secondEq.mockReturnValue({ maybeSingle, select: mutationSelect, eq: secondEq })
    insert.mockReturnValue({ select: mutationSelect })
    update.mockReturnValue({ eq: firstEq })
    mutationSelect.mockReturnValue({ single })
    from.mockReturnValue({ select, insert, update })
  })

  it('lists only the organizer events ordered newest-first', async () => {
    order.mockResolvedValue({ data: [event], error: null })

    await expect(listOwnedEvents('organizer-1')).resolves.toEqual([event])

    expect(from).toHaveBeenCalledWith('events')
    expect(select).toHaveBeenCalledWith('*')
    expect(firstEq).toHaveBeenCalledWith('organizer_id', 'organizer-1')
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('loads by both event ID and organizer ID and hides empty/RLS results', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })

    await expect(getOwnedEvent('event-1', 'organizer-1')).resolves.toBeNull()

    expect(firstEq).toHaveBeenCalledWith('id', 'event-1')
    expect(secondEq).toHaveBeenCalledWith('organizer_id', 'organizer-1')
    expect(maybeSingle).toHaveBeenCalledOnce()
  })

  it('throws actual owned-event query errors', async () => {
    const error = { code: '42501', message: 'permission denied' }
    maybeSingle.mockResolvedValue({ data: null, error })

    await expect(getOwnedEvent('event-1', 'organizer-1')).rejects.toBe(error)
  })

  it('inserts ownership only for a first save and normalizes optional strings', async () => {
    single.mockResolvedValue({ data: event, error: null })

    await expect(
      saveEventDraft({ eventId: null, organizerId: 'organizer-1', values }),
    ).resolves.toEqual(event)

    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      organizer_id: 'organizer-1',
      venue_name: null,
      address_line2: null,
      country_code: 'US',
      latitude: 37.7793,
      longitude: -122.4193,
      starts_at: '2026-08-25T02:00:00.000Z',
      ends_at: '2026-08-25T05:00:00.000Z',
    })
    expectSafePayload(payload)
    expect(mutationSelect).toHaveBeenCalledWith('*')
    expect(single).toHaveBeenCalledOnce()
  })

  it('updates only the supplied owned ID without writing organizer ownership', async () => {
    single.mockResolvedValue({ data: event, error: null })

    await expect(
      saveEventDraft({ eventId: 'event-1', organizerId: 'organizer-1', values }),
    ).resolves.toEqual(event)

    const payload = update.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('organizer_id')
    expectSafePayload(payload)
    expect(firstEq).toHaveBeenCalledWith('id', 'event-1')
    expect(secondEq).toHaveBeenCalledWith('organizer_id', 'organizer-1')
  })

  it('normalizes blank draft fields and a cleared location to writable nulls', async () => {
    single.mockResolvedValue({ data: event, error: null })

    await saveEventDraft({
      eventId: null,
      organizerId: 'organizer-1',
      values: {
        ...values,
        title: ' ',
        description: '\t',
        category: '   ' as EventFormValues['category'],
        startsAt: '',
        endsAt: '   ',
        location: null,
      },
    })

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: null,
        description: null,
        category: null,
        starts_at: null,
        ends_at: null,
        address_line1: null,
        address_line2: null,
        city: null,
        region: null,
        postal_code: null,
        mapbox_feature_id: null,
        latitude: null,
        longitude: null,
        country_code: 'US',
      }),
    )
  })

  it('maps a persisted database row to the single editor form contract', () => {
    expect(eventRowToFormValues(event)).toEqual({
      ...values,
      venueName: 'Civic Center Plaza',
      location: { ...values.location, addressLine2: '' },
    })
    expect(eventRowToFormValues({ ...event, region: 'NV' }).location).toBeNull()
  })

  it.each([
    ['2026-01-15T20:30:00.000Z', '2026-01-15T12:30'],
    ['2026-07-15T19:30:00.000Z', '2026-07-15T12:30'],
  ])('round-trips a persisted %s instant through LA wall time', async (instant, wallTime) => {
    const persisted = { ...event, starts_at: instant, ends_at: instant }
    const mapped = eventRowToFormValues(persisted)
    expect(mapped.startsAt).toBe(wallTime)
    expect(mapped.endsAt).toBe(wallTime)

    single.mockResolvedValue({ data: persisted, error: null })
    await saveEventDraft({ eventId: 'event-returned', organizerId: 'organizer-1', values: mapped })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ starts_at: instant, ends_at: instant }),
    )
  })

  it('round-trips nullable persisted schedule columns without inventing dates', async () => {
    const persisted = { ...event, starts_at: null, ends_at: null }
    const mapped = eventRowToFormValues(persisted)
    expect(mapped.startsAt).toBe('')
    expect(mapped.endsAt).toBe('')

    single.mockResolvedValue({ data: persisted, error: null })
    await saveEventDraft({ eventId: 'event-returned', organizerId: 'organizer-1', values: mapped })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ starts_at: null, ends_at: null }))
  })

  it('round-trips instants immediately across the spring-forward gap', async () => {
    const persisted = {
      ...event,
      starts_at: '2026-03-08T09:59:00.000Z',
      ends_at: '2026-03-08T10:00:00.000Z',
    }
    const mapped = eventRowToFormValues(persisted)
    expect(mapped.startsAt).toBe('2026-03-08T01:59')
    expect(mapped.endsAt).toBe('2026-03-08T03:00')

    single.mockResolvedValue({ data: persisted, error: null })
    await saveEventDraft({ eventId: 'event-returned', organizerId: 'organizer-1', values: mapped })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        starts_at: '2026-03-08T09:59:00.000Z',
        ends_at: '2026-03-08T10:00:00.000Z',
      }),
    )
  })

  it('normalizes both fall-back occurrences to the documented earliest instant', async () => {
    const persisted = {
      ...event,
      starts_at: '2026-11-01T08:30:00.000Z',
      ends_at: '2026-11-01T09:30:00.000Z',
    }
    const mapped = eventRowToFormValues(persisted)
    expect(mapped.startsAt).toBe('2026-11-01T01:30')
    expect(mapped.endsAt).toBe('2026-11-01T01:30')

    single.mockResolvedValue({ data: persisted, error: null })
    await saveEventDraft({ eventId: 'event-returned', organizerId: 'organizer-1', values: mapped })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        starts_at: '2026-11-01T08:30:00.000Z',
        ends_at: '2026-11-01T08:30:00.000Z',
      }),
    )
  })

  it('publishes only through the RPC and returns its persisted row', async () => {
    const published = { ...event, id: 'server-event-id', status: 'published' }
    rpc.mockResolvedValue({ data: published, error: null })

    await expect(publishEvent('requested-event-id')).resolves.toEqual(published)

    expect(rpc).toHaveBeenCalledWith('publish_event', { p_event_id: 'requested-event-id' })
    expect(from).not.toHaveBeenCalled()
  })

  it.each(['list', 'insert', 'update', 'publish'] as const)(
    'propagates %s errors unchanged',
    async (operation) => {
      const error = { code: 'P0001', message: 'EVENT_INCOMPLETE' }
      if (operation === 'list') {
        order.mockResolvedValue({ data: null, error })
        await expect(listOwnedEvents('organizer-1')).rejects.toBe(error)
      } else if (operation === 'publish') {
        rpc.mockResolvedValue({ data: null, error })
        await expect(publishEvent('event-1')).rejects.toBe(error)
      } else {
        single.mockResolvedValue({ data: null, error })
        await expect(
          saveEventDraft({
            eventId: operation === 'insert' ? null : 'event-1',
            organizerId: 'organizer-1',
            values,
          }),
        ).rejects.toBe(error)
      }
    },
  )
})

describe('event query cache contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    from.mockReturnValue({ insert, update, select })
    insert.mockReturnValue({ select: mutationSelect })
    update.mockReturnValue({ eq: firstEq })
    firstEq.mockReturnValue({ eq: secondEq })
    secondEq.mockReturnValue({ select: mutationSelect })
    mutationSelect.mockReturnValue({ single })
    select.mockReturnValue({ eq: firstEq })
  })

  function setupQueryClient() {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    return { queryClient, wrapper }
  }

  it('save seeds only returned detail and invalidates only returned owner list', async () => {
    single.mockResolvedValue({ data: event, error: null })
    const { queryClient, wrapper } = setupQueryClient()
    queryClient.setQueryData(eventKeys.ownedList('organizer-1'), ['old'])
    queryClient.setQueryData(eventKeys.ownedList('organizer-2'), ['unrelated'])
    queryClient.setQueryData(eventKeys.detail('organizer-2', 'unrelated'), 'unrelated detail')
    const { result } = renderHook(() => useSaveEventDraft(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ eventId: null, organizerId: 'organizer-1', values })
    })

    expect(queryClient.getQueryData(eventKeys.detail('organizer-1', 'event-returned'))).toEqual(event)
    expect(queryClient.getQueryState(eventKeys.ownedList('organizer-1'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(eventKeys.ownedList('organizer-2'))?.isInvalidated).toBe(false)
    expect(queryClient.getQueryData(eventKeys.detail('organizer-2', 'unrelated'))).toBe(
      'unrelated detail',
    )
  })

  it('an account switch never reuses another organizer cached owned draft', async () => {
    const organizerAEvent = { ...event, id: 'event-x', organizer_id: 'organizer-a' }
    const { queryClient, wrapper } = setupQueryClient()
    queryClient.setQueryData(eventKeys.detail('organizer-a', 'event-x'), organizerAEvent)
    firstEq.mockReturnValueOnce({ eq: secondEq })
    secondEq.mockReturnValueOnce({ maybeSingle })
    maybeSingle.mockResolvedValue({ data: null, error: null })

    const { result } = renderHook(() => useOwnedEvent('event-x', 'organizer-b'), { wrapper })

    expect(result.current.data).toBeUndefined()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
    expect(queryClient.getQueryData(eventKeys.detail('organizer-a', 'event-x'))).toEqual(
      organizerAEvent,
    )
    expect(firstEq).toHaveBeenCalledWith('id', 'event-x')
    expect(secondEq).toHaveBeenCalledWith('organizer_id', 'organizer-b')
  })

  it('publish invalidates requested and returned owner-aware contracts only', async () => {
    const published = {
      ...event,
      id: 'server-event-id',
      organizer_id: 'organizer-2',
      status: 'published',
    }
    rpc.mockResolvedValue({ data: published, error: null })
    const { queryClient, wrapper } = setupQueryClient()
    queryClient.setQueryData(eventKeys.ownedList('organizer-1'), ['old'])
    queryClient.setQueryData(eventKeys.ownedList('organizer-2'), ['returned owner'])
    queryClient.setQueryData(eventKeys.ownedList('organizer-3'), ['unrelated'])
    queryClient.setQueryData(
      eventKeys.detail('organizer-1', 'requested-event-id'),
      'requested detail',
    )
    queryClient.setQueryData(
      eventKeys.detail('organizer-2', 'server-event-id'),
      'returned detail',
    )
    queryClient.setQueryData(eventKeys.detail('organizer-3', 'unrelated'), 'unrelated detail')
    const { result } = renderHook(() => usePublishEvent('organizer-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('requested-event-id')
    })

    expect(queryClient.getQueryState(eventKeys.ownedList('organizer-1'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(eventKeys.ownedList('organizer-2'))?.isInvalidated).toBe(true)
    expect(
      queryClient.getQueryState(eventKeys.detail('organizer-1', 'requested-event-id'))
        ?.isInvalidated,
    ).toBe(true)
    expect(
      queryClient.getQueryState(eventKeys.detail('organizer-2', 'server-event-id'))?.isInvalidated,
    ).toBe(true)
    expect(queryClient.getQueryData(eventKeys.detail('organizer-1', 'requested-event-id'))).toBe(
      'requested detail',
    )
    expect(queryClient.getQueryData(eventKeys.detail('organizer-2', 'server-event-id'))).toBe(
      'returned detail',
    )
    expect(queryClient.getQueryState(eventKeys.ownedList('organizer-3'))?.isInvalidated).toBe(false)
    expect(queryClient.getQueryData(eventKeys.detail('organizer-3', 'unrelated'))).toBe(
      'unrelated detail',
    )
  })
})
