import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizerInput } from './organizer.schemas'

const { from, insert, lookupEq, maybeSingle, mutationSelect, single, update, updateEq } = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  lookupEq: vi.fn(),
  maybeSingle: vi.fn(),
  mutationSelect: vi.fn(),
  single: vi.fn(),
  update: vi.fn(),
  updateEq: vi.fn(),
}))

vi.mock('../../lib/supabase/client', () => ({ supabase: { from } }))

import { getOrganizer, saveOrganizer, type Organizer } from './organizer.api'

const organizer: Organizer = {
  id: 'user-1',
  display_name: 'Bay City Arts',
  organizer_type: 'Community group',
  bio: 'Neighborhood events made with care.',
  website_url: 'https://baycity.example',
  base_city: 'San Francisco',
  country_code: 'US',
  onboarding_completed_at: '2026-08-24T12:00:00.000Z',
  created_at: '2026-08-24T12:00:00.000Z',
  updated_at: '2026-08-24T12:00:00.000Z',
}

const input: OrganizerInput = {
  displayName: 'Bay City Arts',
  organizerType: '',
  bio: 'Neighborhood events made with care.',
  websiteUrl: '   ',
  baseCity: '   ',
}

const lookupSelect = vi.fn(() => ({ eq: lookupEq }))
const lookupBuilder = { select: lookupSelect }
const insertBuilder = { insert }
const updateBuilder = { update }

function arrangeLookup(result: { data: Organizer | null; error: unknown }) {
  maybeSingle.mockResolvedValue(result)
  lookupEq.mockReturnValue({ maybeSingle })
}

function arrangeInsert(result: { data: Organizer | null; error: unknown }) {
  from.mockReturnValueOnce(lookupBuilder).mockReturnValueOnce(insertBuilder)
  insert.mockReturnValue({ select: mutationSelect })
  mutationSelect.mockReturnValue({ single })
  single.mockResolvedValue(result)
}

function arrangeUpdate(result: { data: Organizer | null; error: unknown }) {
  from.mockReturnValueOnce(lookupBuilder).mockReturnValueOnce(updateBuilder)
  update.mockReturnValue({ eq: updateEq })
  updateEq.mockReturnValue({ select: mutationSelect })
  mutationSelect.mockReturnValue({ single })
  single.mockResolvedValue(result)
}

describe('organizer API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    from.mockReturnValue(lookupBuilder)
    arrangeLookup({ data: organizer, error: null })
  })

  it('loads an organizer by the authenticated user ID', async () => {
    await expect(getOrganizer('user-1')).resolves.toEqual(organizer)

    expect(from).toHaveBeenCalledWith('organizers')
    expect(lookupSelect).toHaveBeenCalledWith('id,display_name,organizer_type,bio,website_url,base_city,country_code,onboarding_completed_at,created_at,updated_at')
    expect(lookupEq).toHaveBeenCalledWith('id', 'user-1')
    expect(maybeSingle).toHaveBeenCalledOnce()
  })

  it.each([
    [{ data: null, error: null }],
    [{ data: null, error: { code: 'PGRST116', message: 'No rows' } }],
  ])('maps an empty organizer result to null', async (result) => {
    arrangeLookup(result)

    await expect(getOrganizer('user-1')).resolves.toBeNull()
  })

  it('throws organizer query errors other than an empty result', async () => {
    const error = { code: '42501', message: 'permission denied' }
    arrangeLookup({ data: null, error })

    await expect(getOrganizer('user-1')).rejects.toBe(error)
  })

  it('inserts a missing organizer with ownership derived from userId', async () => {
    arrangeLookup({ data: null, error: null })
    arrangeInsert({ data: organizer, error: null })

    await expect(
      saveOrganizer('user-1', { ...input, id: 'attacker-id' } as OrganizerInput & { id: string }),
    ).resolves.toEqual(organizer)

    expect(insert).toHaveBeenCalledWith({
      id: 'user-1',
      display_name: 'Bay City Arts',
      organizer_type: null,
      bio: 'Neighborhood events made with care.',
      website_url: null,
      base_city: null,
      country_code: 'US',
      onboarding_completed_at: null,
    })
    expect(update).not.toHaveBeenCalled()
    expect(mutationSelect).toHaveBeenCalledWith('id,display_name,organizer_type,bio,website_url,base_city,country_code,onboarding_completed_at,created_at,updated_at')
    expect(single).toHaveBeenCalledOnce()
  })

  it('updates an existing organizer using only granted mutable columns and an ownership filter', async () => {
    arrangeUpdate({ data: organizer, error: null })

    await expect(
      saveOrganizer('user-1', { ...input, id: 'attacker-id' } as OrganizerInput & { id: string }),
    ).resolves.toEqual(organizer)

    expect(update).toHaveBeenCalledWith({
      display_name: 'Bay City Arts',
      organizer_type: null,
      bio: 'Neighborhood events made with care.',
      website_url: null,
      base_city: null,
      country_code: 'US',
      onboarding_completed_at: expect.any(String),
    })
    expect(updateEq).toHaveBeenCalledWith('id', 'user-1')
    expect(insert).not.toHaveBeenCalled()
    expect(mutationSelect).toHaveBeenCalledWith('id,display_name,organizer_type,bio,website_url,base_city,country_code,onboarding_completed_at,created_at,updated_at')
    expect(single).toHaveBeenCalledOnce()
  })

  it('propagates the existence lookup error without attempting a mutation', async () => {
    const error = { code: '42501', message: 'permission denied' }
    arrangeLookup({ data: null, error })

    await expect(saveOrganizer('user-1', input)).rejects.toBe(error)

    expect(insert).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it.each(['insert', 'update'] as const)('propagates %s errors and rejects empty data', async (operation) => {
    const error = { code: '42501', message: 'permission denied' }
    if (operation === 'insert') {
      arrangeLookup({ data: null, error: null })
      arrangeInsert({ data: null, error })
    } else {
      arrangeUpdate({ data: null, error })
    }
    await expect(saveOrganizer('user-1', input)).rejects.toBe(error)

    vi.clearAllMocks()
    arrangeLookup({ data: operation === 'insert' ? null : organizer, error: null })
    if (operation === 'insert') {
      arrangeInsert({ data: null, error: null })
    } else {
      arrangeUpdate({ data: null, error: null })
    }
    await expect(saveOrganizer('user-1', input)).rejects.toThrow('Organizer profile was not returned')
  })
})
