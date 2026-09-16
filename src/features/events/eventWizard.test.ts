import { describe, expect, it } from 'vitest'
import { creationStepFromSearch, draftResumeStep, stepIssues } from './eventWizard'
import type { EventFormValues } from './event.types'

const values: EventFormValues = { title: 'An evening together', description: 'A neighborhood gathering with music and good food.', category: 'community', startsAt: '2099-12-01T19:00', endsAt: '2099-12-02T01:00', timezone: 'America/Los_Angeles', venueName: 'The hall', location: { mapboxFeatureId: 'address.1', addressLine1: '1 Market St', addressLine2: '', city: 'San Francisco', region: 'CA', postalCode: '94105', countryCode: 'US', latitude: 37.79, longitude: -122.4 }, admissionType: 'free', capacity: null }

describe('creation navigation from canonical drafts', () => {
  it('keeps incomplete basics on Basics but does not require later fields', () => {
    expect(stepIssues({ ...values, title: '', startsAt: '', location: null }, 1).map(issue => issue.path[0])).toEqual(['title'])
    expect(stepIssues({ ...values, startsAt: '', location: null }, 1)).toEqual([])
    expect(draftResumeStep({ ...values, title: '' }, 0, false)).toBe(1)
  })
  it('requires a verified service-area location and ordered schedule before continuing', () => {
    expect(stepIssues({ ...values, location: null, endsAt: values.startsAt }, 2).map(issue => issue.path[0])).toEqual(['location', 'endsAt'])
    expect(stepIssues({ ...values, location: { ...values.location!, latitude: 34 } }, 2).map(issue => issue.path[0])).toEqual(['location'])
    expect(stepIssues(values, 2)).toEqual([])
  })
  it('uses paid tier persistence and acceptance to resume without inventing a wizard record', () => {
    expect(draftResumeStep({ ...values, startsAt: '' }, 0, false)).toBe(2)
    expect(draftResumeStep(values, 0, false)).toBe(3)
    expect(draftResumeStep({ ...values, admissionType: 'paid' }, 0, false)).toBe(3)
    expect(draftResumeStep({ ...values, admissionType: 'paid' }, 2, false)).toBe(4)
    expect(draftResumeStep(values, 0, true)).toBe(4)
  })
  it('supports explicit steps and the existing requirements link but ignores arbitrary values', () => {
    expect(creationStepFromSearch('?step=basics')).toBe(1)
    expect(creationStepFromSearch('?step=date-location')).toBe(2)
    expect(creationStepFromSearch('?step=ticket-type')).toBe(3)
    expect(creationStepFromSearch('?step=requirements')).toBe(4)
    expect(creationStepFromSearch('?step=details')).toBe(4)
    expect(creationStepFromSearch('?step=999')).toBeNull()
  })
})
