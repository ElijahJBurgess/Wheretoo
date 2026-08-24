import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizerInput } from './organizer.schemas'

const { eq, from, maybeSingle, select, single, upsert } = vi.hoisted(() => ({
  eq: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  upsert: vi.fn(),
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
  websiteUrl: '',
  baseCity: '   ',
}

describe('organizer API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    from.mockReturnValue({ select, upsert })
    select.mockReturnValue({ eq, single })
    eq.mockReturnValue({ maybeSingle })
    upsert.mockReturnValue({ select })
  })

  it('loads an organizer by the authenticated user ID', async () => {
    maybeSingle.mockResolvedValue({ data: organizer, error: null })

    await expect(getOrganizer('user-1')).resolves.toEqual(organizer)

    expect(from).toHaveBeenCalledWith('organizers')
    expect(select).toHaveBeenCalledWith('*')
    expect(eq).toHaveBeenCalledWith('id', 'user-1')
    expect(maybeSingle).toHaveBeenCalledOnce()
  })

  it.each([
    [{ data: null, error: null }],
    [{ data: null, error: { code: 'PGRST116', message: 'No rows' } }],
  ])('maps an empty organizer result to null', async (result) => {
    maybeSingle.mockResolvedValue(result)

    await expect(getOrganizer('user-1')).resolves.toBeNull()
  })

  it('throws organizer query errors other than an empty result', async () => {
    const error = { code: '42501', message: 'permission denied' }
    maybeSingle.mockResolvedValue({ data: null, error })

    await expect(getOrganizer('user-1')).rejects.toBe(error)
  })

  it('upserts ownership from userId and normalizes optional empty values', async () => {
    single.mockResolvedValue({ data: organizer, error: null })

    await expect(
      saveOrganizer('user-1', { ...input, id: 'attacker-id' } as OrganizerInput & { id: string }),
    ).resolves.toEqual(organizer)

    expect(upsert).toHaveBeenCalledOnce()
    const [payload, options] = upsert.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(options).toEqual({ onConflict: 'id' })
    expect(payload).toEqual({
      id: 'user-1',
      display_name: 'Bay City Arts',
      organizer_type: null,
      bio: 'Neighborhood events made with care.',
      website_url: null,
      base_city: null,
      country_code: 'US',
      onboarding_completed_at: expect.any(String),
    })
    expect(Number.isNaN(Date.parse(payload.onboarding_completed_at as string))).toBe(false)
    expect(select).toHaveBeenLastCalledWith('*')
    expect(single).toHaveBeenCalledOnce()
  })

  it('throws an upsert error and does not return empty data', async () => {
    const error = { code: '42501', message: 'permission denied' }
    single.mockResolvedValueOnce({ data: null, error })
    await expect(saveOrganizer('user-1', input)).rejects.toBe(error)

    single.mockResolvedValueOnce({ data: null, error: null })
    await expect(saveOrganizer('user-1', input)).rejects.toThrow('Organizer profile was not returned')
  })
})
