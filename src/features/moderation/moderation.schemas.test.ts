import { describe, expect, it } from 'vitest'
import {
  agreementStatusSchema,
  currentReviewRequestSchema,
  eventRequirementsSchema,
  legacyHistoryResolutionInputSchema,
  moderationActionInputSchema,
  moderationSourceSchema,
  policyStageSchema,
  reportReasonSchema,
  requiredPolicySchema,
} from './moderation.schemas'

const developmentPolicies = [
  {
    policyKind: 'organizer_terms', label: 'Organizer Terms', versionId: 'dev-organizer-terms-v1',
    stage: 'development_placeholder', publicUrl: '/organizer-terms', effectiveAt: '2026-08-26T00:00:00Z',
  },
  {
    policyKind: 'event_policy', label: 'Event Policy', versionId: 'dev-event-policy-v1',
    stage: 'development_placeholder', publicUrl: '/event-policy', effectiveAt: '2026-08-26T00:00:00Z',
  },
] as const

const requirements = {
  minimumAge: '21_plus', alcoholPresent: true, cannabisPresent: false,
  explicitAdultContent: false, gamblingPresent: false, weaponsPresent: false,
  highRiskActivity: false, needsAcceptance: true,
  organizerTerms: developmentPolicies[0], eventPolicy: developmentPolicies[1],
}

describe('moderation browser schemas', () => {
  it('accepts only the narrow organizer-facing current review request contract', () => {
    const review = {
      id: '37beaa67-b2a2-4b56-9c6c-e91208925c45',
      status: 'open',
      createdAt: '2026-08-26T00:00:00Z',
      resolvedAt: null,
    }

    expect(currentReviewRequestSchema.parse(review)).toEqual(review)
    expect(() => currentReviewRequestSchema.parse({ ...review, organizerNote: 'private note' })).toThrow()
    expect(() => currentReviewRequestSchema.parse({ ...review, reviewerId: 'staff-1' })).toThrow()
    expect(() => currentReviewRequestSchema.parse({ ...review, status: 'superseded' })).toThrow()
  })
  it('accepts only the exact development placeholder routes, versions, and stage', () => {
    expect(requiredPolicySchema.safeParse(developmentPolicies[0]).success).toBe(true)
    expect(requiredPolicySchema.safeParse({ ...developmentPolicies[0], publicUrl: 'https://whereto.example/organizer-terms' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...developmentPolicies[0], versionId: 'organizer-terms-v1' }).success).toBe(false)
  })

  it('requires canonical HTTPS production policies with non-development version IDs', () => {
    const production = {
      ...developmentPolicies[0], versionId: 'organizer-terms-v2', stage: 'production_approved',
      publicUrl: 'https://whereto.example.com/legal/organizer-terms-v2',
    }
    expect(policyStageSchema.safeParse('production_approved').success).toBe(true)
    expect(requiredPolicySchema.safeParse(production).success).toBe(true)
    expect(requiredPolicySchema.safeParse({ ...production, publicUrl: '/legal/terms' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, versionId: 'dev-organizer-terms-v2' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, versionId: ` ${production.versionId}` }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, versionId: 'x'.repeat(121) }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, publicUrl: 'https://' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, publicUrl: ' https://whereto.example.com/legal/organizer-terms-v2' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, publicUrl: 'https://user@whereto.example.com/legal' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, publicUrl: 'https://whereto.example.com:443/legal' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, publicUrl: 'https://whereto.example.com/legal?draft=1' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, publicUrl: 'https://whereto.example.com/legal#section' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, publicUrl: 'https://Whereto.example.com/legal' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, publicUrl: 'https://./' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, publicUrl: 'https://bad..example/legal' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, publicUrl: 'https://-bad.example/legal' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, publicUrl: 'https://bad-.example/legal' }).success).toBe(false)
    expect(requiredPolicySchema.safeParse({ ...production, publicUrl: 'https://127.0.0.1/legal' }).success).toBe(false)
  })

  it('accepts all seven owner disclosure values but no acceptance internals', () => {
    expect(eventRequirementsSchema.safeParse(requirements).success).toBe(true)
    expect(eventRequirementsSchema.safeParse({ ...requirements, acceptanceId: 'private' }).success).toBe(false)
    expect(eventRequirementsSchema.safeParse({ ...requirements, acceptedAt: '2026-08-26T00:00:00Z' }).success).toBe(false)
    expect(agreementStatusSchema.safeParse(requirements).success).toBe(true)
  })

  it.each([
    'scam_misleading', 'unsafe', 'prohibited_content', 'wrong_location', 'event_missing',
    'adult_misrepresented', 'hate_extremism', 'other',
  ])('accepts report reason %s', (reason) => {
    expect(reportReasonSchema.safeParse(reason).success).toBe(true)
  })

  it('keeps report reasons and staff actions closed unions', () => {
    expect(reportReasonSchema.safeParse('free_text').success).toBe(false)
    expect(moderationActionInputSchema.safeParse({
      eventId: 'b4ee321a-bdf6-43b2-a7f4-d6478d942908', expectedContentRevision: 4,
      expectedInputSha256: 'a'.repeat(64), expectedModerationVersion: 7,
      action: 'remove', reasonCode: 'user_report', internalNote: 'Repeated fraudulent listings.',
    }).success).toBe(true)
    expect(moderationActionInputSchema.safeParse({
      eventId: 'b4ee321a-bdf6-43b2-a7f4-d6478d942908', expectedContentRevision: 4,
      expectedInputSha256: 'A'.repeat(64), expectedModerationVersion: 7,
      action: 'delete', reasonCode: 'user_report', internalNote: null,
    }).success).toBe(false)
  })

  it('keeps moderation sources an exact closed union including report escalation', () => {
    expect(moderationSourceSchema.options).toEqual([
      'publish', 'edit', 'evaluation', 'review_request', 'manual', 'migration', 'report_escalation',
    ])
    expect(moderationSourceSchema.safeParse('report_escalation').success).toBe(true)
    expect(moderationSourceSchema.safeParse('report').success).toBe(false)
  })

  it('binds legacy history evidence to the selected history and nullable observed time', () => {
    const base = {
      eventId: 'b4ee321a-bdf6-43b2-a7f4-d6478d942908',
      expectedContentRevision: 4,
      expectedInputSha256: 'a'.repeat(64),
      expectedModerationVersion: 7,
      publicHistoryStatus: 'never_public',
      evidenceCode: 'legacy_archive_verified_never_public',
      observedPublicAt: null,
      internalNote: '',
    }

    expect(legacyHistoryResolutionInputSchema.safeParse(base).success).toBe(true)
    expect(legacyHistoryResolutionInputSchema.safeParse({
      ...base,
      publicHistoryStatus: 'previously_public',
      evidenceCode: 'legacy_archive_verified_public',
      observedPublicAt: '2026-08-20T12:00:00Z',
    }).success).toBe(true)
    expect(legacyHistoryResolutionInputSchema.safeParse({ ...base, observedPublicAt: '2026-08-20T12:00:00Z' }).success).toBe(false)
    expect(legacyHistoryResolutionInputSchema.safeParse({
      ...base,
      publicHistoryStatus: 'previously_public',
      evidenceCode: 'legacy_archive_verified_never_public',
    }).success).toBe(false)
  })
})
