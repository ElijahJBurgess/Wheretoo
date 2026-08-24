import { describe, expect, it } from 'vitest'
import { organizerInputSchema } from './organizer.schemas'

const validInput = {
  displayName: 'Bay City Arts',
  organizerType: 'Community group',
  bio: 'Neighborhood events made with care.',
  websiteUrl: 'https://baycity.example/events',
  baseCity: 'San Francisco',
}

describe('organizerInputSchema', () => {
  it('accepts empty optional fields and trims the fields used for public identity', () => {
    expect(
      organizerInputSchema.parse({
        displayName: '  Bay City Arts  ',
        organizerType: '',
        bio: '',
        websiteUrl: '',
        baseCity: '',
      }),
    ).toEqual({
      displayName: 'Bay City Arts',
      organizerType: '',
      bio: '',
      websiteUrl: '',
      baseCity: '',
    })
  })

  it('rejects an invalid website', () => {
    expect(organizerInputSchema.safeParse({ ...validInput, websiteUrl: 'bay city arts' }).success).toBe(false)
  })

  it('rejects a display name shorter than two characters after trimming', () => {
    expect(organizerInputSchema.safeParse({ ...validInput, displayName: ' A ' }).success).toBe(false)
  })

  it.each([
    ['displayName', 'x'.repeat(101)],
    ['organizerType', 'x'.repeat(81)],
    ['bio', 'x'.repeat(501)],
    ['websiteUrl', `https://example.com/${'x'.repeat(481)}`],
    ['baseCity', 'x'.repeat(121)],
  ] as const)('rejects %s beyond its maximum length', (field, value) => {
    expect(organizerInputSchema.safeParse({ ...validInput, [field]: value }).success).toBe(false)
  })
})
