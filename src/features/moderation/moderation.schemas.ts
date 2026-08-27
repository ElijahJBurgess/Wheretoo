import { z } from 'zod'

const uuidSchema = z.string().uuid()
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const policyStageSchema = z.enum(['development_placeholder', 'production_approved'])
export const policyKindSchema = z.enum(['organizer_terms', 'event_policy'])
export const minimumAgeSchema = z.enum(['all_ages', '18_plus', '21_plus'])
export const moderationStatusSchema = z.enum(['not_evaluated', 'clear', 'under_review', 'blocked', 'removed'])
export const publicHistoryStatusSchema = z.enum(['unknown', 'never_public', 'previously_public'])
export const moderationHistoryActionSchema = z.enum([
  'record_revision', 'authorize_publication', 'clear', 'hold', 'block', 'remove', 'restore',
  'resolve_legacy_history', 'request_review', 'resolve_review',
])
export const moderationSourceSchema = z.enum(['publish', 'edit', 'evaluation', 'review_request', 'manual', 'migration'])
export const moderationActorTypeSchema = z.enum(['system', 'organizer', 'moderator', 'admin'])

export const requiredPolicySchema = z
  .strictObject({
    policyKind: policyKindSchema,
    label: z.enum(['Organizer Terms', 'Event Policy']),
    versionId: z.string().min(1).max(120),
    stage: policyStageSchema,
    publicUrl: z.string().min(1),
    effectiveAt: z.string().min(1).optional(),
  })
  .superRefine((policy, context) => {
    const isDevelopment = policy.stage === 'development_placeholder'
    const expected = policy.policyKind === 'organizer_terms'
      ? { versionId: 'dev-organizer-terms-v1', publicUrl: '/organizer-terms', label: 'Organizer Terms' }
      : { versionId: 'dev-event-policy-v1', publicUrl: '/event-policy', label: 'Event Policy' }

    if (policy.label !== expected.label) {
      context.addIssue({ code: 'custom', path: ['label'], message: 'Policy label does not match its kind.' })
    }
    if (isDevelopment && (policy.versionId !== expected.versionId || policy.publicUrl !== expected.publicUrl)) {
      context.addIssue({ code: 'custom', message: 'Development policy must use the approved placeholder contract.' })
    }
    if (!isDevelopment && (policy.versionId !== policy.versionId.trim() || policy.versionId.startsWith('dev-') || !isCanonicalProductionUrl(policy.publicUrl))) {
      context.addIssue({ code: 'custom', message: 'Production policy must use a canonical HTTPS URL and production version.' })
    }
  })

function isCanonicalProductionUrl(value: string): boolean {
  if (value !== value.trim() || !/^https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._~:/-]*)?$/.test(value)) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:'
      && parsed.hostname.length > 0
      && parsed.username === ''
      && parsed.password === ''
      && parsed.port === ''
      && parsed.search === ''
      && parsed.hash === ''
      && parsed.href === value
  } catch {
    return false
  }
}

const disclosureValuesSchema = z.strictObject({
  minimumAge: minimumAgeSchema,
  alcoholPresent: z.boolean(),
  cannabisPresent: z.boolean(),
  explicitAdultContent: z.boolean(),
  gamblingPresent: z.boolean(),
  weaponsPresent: z.boolean(),
  highRiskActivity: z.boolean(),
})

export const eventRequirementsSchema = disclosureValuesSchema.extend({
  needsAcceptance: z.boolean(),
  organizerTerms: requiredPolicySchema,
  eventPolicy: requiredPolicySchema,
}).superRefine((requirements, context) => {
  if (requirements.organizerTerms.policyKind !== 'organizer_terms') {
    context.addIssue({ code: 'custom', path: ['organizerTerms'], message: 'Organizer Terms policy is required.' })
  }
  if (requirements.eventPolicy.policyKind !== 'event_policy') {
    context.addIssue({ code: 'custom', path: ['eventPolicy'], message: 'Event Policy is required.' })
  }
})

export const agreementStatusSchema = eventRequirementsSchema
export const eventRequirementsInputSchema = disclosureValuesSchema

export const reportReasonSchema = z.enum([
  'scam_misleading', 'unsafe', 'prohibited_content', 'wrong_location', 'event_missing',
  'adult_misrepresented', 'hate_extremism', 'other',
])

export const moderationActionSchema = z.enum(['hold', 'block', 'remove', 'clear', 'restore'])
export const moderationReasonCodeSchema = z.enum([
  'adult_explicit', 'weapons', 'gambling', 'hate_extremism', 'scam_misleading',
  'unsafe_activity', 'location_invalid', 'age_mismatch', 'disclosure_mismatch',
  'user_report', 'no_violation', 'other',
])

export const moderationActionInputSchema = z.strictObject({
  eventId: uuidSchema,
  expectedContentRevision: z.number().int().positive(),
  expectedInputSha256: sha256Schema,
  expectedModerationVersion: z.number().int().nonnegative(),
  action: moderationActionSchema,
  reasonCode: moderationReasonCodeSchema,
  internalNote: z.string().max(1000),
})

const actionHistorySchema = z.array(z.strictObject({
  id: uuidSchema,
  action: moderationHistoryActionSchema,
  previous_status: moderationStatusSchema,
  new_status: moderationStatusSchema,
  reason_code: moderationReasonCodeSchema,
  internal_note: z.string().nullable(),
  created_at: z.string(),
  moderation_version: z.number().int().nonnegative(),
}))
const evaluationHistorySchema = z.array(z.strictObject({
  id: uuidSchema,
  content_revision: z.number().int().positive(),
  status: z.enum(['queued', 'processing', 'succeeded', 'failed', 'superseded']),
  source: z.enum(['deterministic', 'contextual', 'human', 'report']),
  outcome: z.enum(['clear_candidate', 'review_required', 'prohibited_candidate']).nullable(),
  risk_level: z.enum(['low', 'high']).nullable(),
  reason_codes: z.array(moderationReasonCodeSchema).max(12),
  failure_code: z.string().min(1).max(80).nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
}))
const legacyResolutionSchema = z.union([
  z.strictObject({}),
  z.strictObject({
    resolved_public_history_status: z.enum(['never_public', 'previously_public']),
    evidence_code: z.enum(['legacy_archive_verified_never_public', 'legacy_archive_verified_public', 'legacy_server_prior_public']),
    observed_public_at: z.string().nullable(),
    created_at: z.string(),
  }),
])

export const moderationCaseSchema = z.strictObject({
  eventId: uuidSchema,
  moderationStatus: moderationStatusSchema,
  contentRevision: z.number().int().positive(),
  inputSha256: sha256Schema,
  moderationVersion: z.number().int().nonnegative(),
  publicHistoryStatus: publicHistoryStatusSchema,
  firstPubliclyEligibleAt: z.string().nullable(),
  title: z.string(), description: z.string(), category: z.string(), startsAt: z.string(), endsAt: z.string(), timezone: z.string(),
  venueName: z.string(), addressLine1: z.string(), addressLine2: z.string().nullable(), city: z.string(), region: z.string(), postalCode: z.string(), countryCode: z.string(),
  mapboxFeatureId: z.string(), latitude: z.number(), longitude: z.number(),
  disclosures: disclosureValuesSchema, legacyResolution: legacyResolutionSchema, actions: actionHistorySchema, evaluations: evaluationHistorySchema,
})

export const moderationQueueItemSchema = z.strictObject({
  eventId: uuidSchema, moderationStatus: moderationStatusSchema, contentRevision: z.number().int().positive(), inputSha256: sha256Schema,
  moderationVersion: z.number().int().nonnegative(), publicHistoryStatus: publicHistoryStatusSchema, queuedEvaluationCount: z.number().int().nonnegative(), oldestQueuedAt: z.string().nullable(),
})

export const staffRoleSchema = z.enum(['moderator', 'admin'])
