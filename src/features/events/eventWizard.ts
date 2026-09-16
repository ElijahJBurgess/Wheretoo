import { eventPublishSchema } from './event.schemas'
import type { EventFormValues } from './event.types'

export type CreationEditorStep = 1 | 2 | 3 | 4
export const creationStepNames = { 1: 'basics', 2: 'date-location', 3: 'ticket-type', 4: 'details' } as const

export function creationStepFromSearch(search: string): CreationEditorStep | null {
  const value = new URLSearchParams(search).get('step')
  if (value === 'requirements') return 4
  for (const step of [1, 2, 3, 4] as const) if (creationStepNames[step] === value) return step
  return null
}

export function stepIssues(values: EventFormValues, step: 1 | 2) {
  const result = eventPublishSchema.safeParse(values)
  if (result.success) return []
  const fields = step === 1 ? ['title', 'description', 'category'] : ['startsAt', 'endsAt', 'location', 'venueName', 'timezone']
  return result.error.issues.filter(issue => fields.includes(String(issue.path[0])))
}

export function draftResumeStep(values: EventFormValues, tierCount: number, agreementCurrent: boolean): CreationEditorStep {
  if (stepIssues(values, 1).length) return 1
  if (stepIssues(values, 2).length) return 2
  if (agreementCurrent || (values.admissionType === 'paid' && tierCount > 0)) return 4
  // `free` is the database default, so it alone does not prove an admission choice.
  return 3
}
