import { z } from 'zod'
import { publicEventSchema } from '../events/event.schemas'
import { supabase } from '../../lib/supabase/client'
import {
  agreementStatusSchema,
  currentReviewRequestSchema,
  eventRequirementsInputSchema,
  eventRequirementsSchema,
  moderationActionInputSchema,
  moderationCaseSchema,
  moderationQueueItemSchema,
  reportReasonSchema,
  requiredPolicySchema,
  staffRoleSchema,
} from './moderation.schemas'
import type {
  AgreementStatus,
  CurrentReviewRequest,
  EventRequirements,
  EventRequirementsInput,
  ModerationActionInput,
  ModerationCase,
  ModerationQueueItem,
  ReportReason,
  RequiredPolicy,
  StaffRole,
} from './moderation.types'

const requirementsRpcRowSchema = z.strictObject({
  minimum_age: z.string(), alcohol_present: z.boolean(), cannabis_present: z.boolean(), explicit_adult_content: z.boolean(),
  gambling_present: z.boolean(), weapons_present: z.boolean(), high_risk_activity: z.boolean(), needs_acceptance: z.boolean(),
  organizer_terms_label: z.string(), organizer_terms_version_id: z.string(), organizer_terms_stage: z.string(), organizer_terms_url: z.string(),
  event_policy_label: z.string(), event_policy_version_id: z.string(), event_policy_stage: z.string(), event_policy_url: z.string(),
})
const savedRequirementsRpcRowSchema = z.strictObject({
  minimum_age: z.string(), alcohol_present: z.boolean(), cannabis_present: z.boolean(), explicit_adult_content: z.boolean(),
  gambling_present: z.boolean(), weapons_present: z.boolean(), high_risk_activity: z.boolean(),
})
const requiredPolicyRpcRowSchema = z.strictObject({
  policy_kind: z.string(), label: z.string(), version_id: z.string(), stage: z.string(), public_url: z.string(), effective_at: z.string(),
})
const moderationCaseRpcRowSchema = z.strictObject({
  event_id: z.string(), moderation_status: z.string(), content_revision: z.number(), input_sha256: z.string(), moderation_version: z.number(), public_history_status: z.string(),
  first_publicly_eligible_at: z.string().nullable(), title: z.string(), description: z.string(), category: z.string(), starts_at: z.string(), ends_at: z.string(), timezone: z.string(),
  venue_name: z.string(), address_line1: z.string(), address_line2: z.string().nullable(), city: z.string(), region: z.string(), postal_code: z.string(), country_code: z.string(),
  mapbox_feature_id: z.string(), latitude: z.number(), longitude: z.number(), disclosures: z.unknown(), legacy_resolution: z.unknown(), actions: z.unknown(), evaluations: z.unknown(),
})
const disclosureRpcSchema = z.strictObject({
  minimum_age: z.string(), alcohol_present: z.boolean(), cannabis_present: z.boolean(), explicit_adult_content: z.boolean(),
  gambling_present: z.boolean(), weapons_present: z.boolean(), high_risk_activity: z.boolean(),
})
const moderationQueueRpcRowSchema = z.strictObject({
  event_id: z.string(), moderation_status: z.string(), content_revision: z.number(), input_sha256: z.string(), moderation_version: z.number(),
  public_history_status: z.string(), queued_evaluation_count: z.number(), oldest_queued_at: z.string().nullable(),
})
const currentReviewRequestRpcRowSchema = z.strictObject({
  id: z.string(), status: z.string(), created_at: z.string(), resolved_at: z.string().nullable(),
})

export type ModerationApiErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE' | 'INVALID'

export class ModerationApiError extends Error {
  constructor(readonly code: ModerationApiErrorCode) {
    super(code === 'NOT_FOUND' ? 'This event is no longer available.' : 'Moderation is temporarily unavailable.')
    this.name = 'ModerationApiError'
  }
}

function safeError(error: { code?: string; message?: string } | null): ModerationApiError {
  if (error?.code === 'PGRST116' || error?.message === 'EVENT_NOT_FOUND') return new ModerationApiError('NOT_FOUND')
  if (error?.message === 'MODERATION_CONFLICT') return new ModerationApiError('CONFLICT')
  if (error?.message?.endsWith('_INVALID') === true) return new ModerationApiError('INVALID')
  return new ModerationApiError('UNAVAILABLE')
}

function parseOne<T>(schema: z.ZodType<T>, data: readonly unknown[] | null): T | null {
  if (data === null || data.length === 0) return null
  if (data.length !== 1) throw new ModerationApiError('UNAVAILABLE')
  const parsed = schema.safeParse(data[0])
  if (!parsed.success) throw new ModerationApiError('UNAVAILABLE')
  return parsed.data
}

function parseContract<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new ModerationApiError('UNAVAILABLE')
  return parsed.data
}

function requirementsFromRpc(row: z.infer<typeof requirementsRpcRowSchema>): EventRequirements {
  return parseContract(eventRequirementsSchema, {
    minimumAge: row.minimum_age,
    alcoholPresent: row.alcohol_present,
    cannabisPresent: row.cannabis_present,
    explicitAdultContent: row.explicit_adult_content,
    gamblingPresent: row.gambling_present,
    weaponsPresent: row.weapons_present,
    highRiskActivity: row.high_risk_activity,
    needsAcceptance: row.needs_acceptance,
    organizerTerms: {
      policyKind: 'organizer_terms', label: row.organizer_terms_label, versionId: row.organizer_terms_version_id,
      stage: row.organizer_terms_stage, publicUrl: row.organizer_terms_url,
    },
    eventPolicy: {
      policyKind: 'event_policy', label: row.event_policy_label, versionId: row.event_policy_version_id,
      stage: row.event_policy_stage, publicUrl: row.event_policy_url,
    },
  })
}

function requirementsInputFromRpc(row: z.infer<typeof savedRequirementsRpcRowSchema>): EventRequirementsInput {
  return parseContract(eventRequirementsInputSchema, {
    minimumAge: row.minimum_age,
    alcoholPresent: row.alcohol_present,
    cannabisPresent: row.cannabis_present,
    explicitAdultContent: row.explicit_adult_content,
    gamblingPresent: row.gambling_present,
    weaponsPresent: row.weapons_present,
    highRiskActivity: row.high_risk_activity,
  })
}

function requiredPolicyFromRpc(row: z.infer<typeof requiredPolicyRpcRowSchema>): RequiredPolicy {
  return parseContract(requiredPolicySchema, {
    policyKind: row.policy_kind, label: row.label, versionId: row.version_id, stage: row.stage,
    publicUrl: row.public_url, effectiveAt: row.effective_at,
  })
}

function moderationCaseFromRpc(row: z.infer<typeof moderationCaseRpcRowSchema>): ModerationCase {
  const disclosures = parseContract(disclosureRpcSchema, row.disclosures)
  return parseContract(moderationCaseSchema, {
    eventId: row.event_id, moderationStatus: row.moderation_status, contentRevision: row.content_revision,
    inputSha256: row.input_sha256, moderationVersion: row.moderation_version, publicHistoryStatus: row.public_history_status,
    firstPubliclyEligibleAt: row.first_publicly_eligible_at, title: row.title, description: row.description,
    category: row.category, startsAt: row.starts_at, endsAt: row.ends_at, timezone: row.timezone,
    venueName: row.venue_name, addressLine1: row.address_line1, addressLine2: row.address_line2,
    city: row.city, region: row.region, postalCode: row.postal_code, countryCode: row.country_code,
    mapboxFeatureId: row.mapbox_feature_id, latitude: row.latitude, longitude: row.longitude,
    disclosures: {
      minimumAge: disclosures.minimum_age, alcoholPresent: disclosures.alcohol_present,
      cannabisPresent: disclosures.cannabis_present, explicitAdultContent: disclosures.explicit_adult_content,
      gamblingPresent: disclosures.gambling_present, weaponsPresent: disclosures.weapons_present,
      highRiskActivity: disclosures.high_risk_activity,
    },
    legacyResolution: row.legacy_resolution, actions: row.actions, evaluations: row.evaluations,
  })
}

export async function getRequiredEventPolicies(): Promise<RequiredPolicy[]> {
  const { data, error } = await supabase.rpc('get_required_event_policies')
  if (error) throw safeError(error)
  const rows = parseContract(z.array(requiredPolicyRpcRowSchema), data)
  return parseContract(z.array(requiredPolicySchema), rows.map(requiredPolicyFromRpc))
}

export async function getOwnedEventRequirements(eventId: string): Promise<EventRequirements | null> {
  const { data, error } = await supabase.rpc('get_owned_event_requirements', { p_event_id: eventId })
  if (error) {
    if (safeError(error).code === 'NOT_FOUND') return null
    throw safeError(error)
  }
  const row = parseOne(requirementsRpcRowSchema, data)
  return row === null ? null : requirementsFromRpc(row)
}

export async function saveEventRequirements(eventId: string, input: EventRequirementsInput): Promise<EventRequirementsInput> {
  const values = eventRequirementsInputSchema.parse(input)
  const { data, error } = await supabase.rpc('save_owned_event_requirements', {
    p_event_id: eventId,
    p_requirements: {
      minimum_age: values.minimumAge, alcohol_present: values.alcoholPresent, cannabis_present: values.cannabisPresent,
      explicit_adult_content: values.explicitAdultContent, gambling_present: values.gamblingPresent,
      weapons_present: values.weaponsPresent, high_risk_activity: values.highRiskActivity,
    },
  })
  if (error) throw safeError(error)
  const row = parseOne(savedRequirementsRpcRowSchema, data)
  if (row === null) throw new ModerationApiError('UNAVAILABLE')
  return requirementsInputFromRpc(row)
}

export async function acceptCurrentEventPolicies(eventId: string): Promise<AgreementStatus> {
  const { data, error } = await supabase.rpc('accept_current_event_policies', { p_event_id: eventId })
  if (error) throw safeError(error)
  const row = parseOne(requirementsRpcRowSchema, data)
  if (row === null) throw new ModerationApiError('UNAVAILABLE')
  return parseContract(agreementStatusSchema, requirementsFromRpc(row))
}

export async function requestEventReview(eventId: string, organizerNote: string): Promise<string> {
  const { data, error } = await supabase.rpc('request_event_review', { p_event_id: eventId, p_organizer_note: organizerNote })
  if (error) throw safeError(error)
  const parsed = z.string().uuid().safeParse(data)
  if (!parsed.success) throw new ModerationApiError('UNAVAILABLE')
  return parsed.data
}

export async function getCurrentEventReviewRequest(eventId: string): Promise<CurrentReviewRequest | null> {
  const { data, error } = await supabase.rpc('get_current_event_review_request', { p_event_id: eventId })
  if (error) throw safeError(error)
  const row = parseOne(currentReviewRequestRpcRowSchema, data)
  if (row === null) return null
  return parseContract(currentReviewRequestSchema, {
    id: row.id, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at,
  })
}

export async function withdrawEventReview(eventId: string): Promise<string> {
  const { data, error } = await supabase.rpc('withdraw_event_review', { p_event_id: eventId })
  if (error) throw safeError(error)
  const parsed = z.string().uuid().safeParse(data)
  if (!parsed.success) throw new ModerationApiError('UNAVAILABLE')
  return parsed.data
}

export async function getMyStaffRole(): Promise<StaffRole | null> {
  const { data, error } = await supabase.rpc('get_my_staff_role')
  if (error) {
    if (error.message === 'STAFF_ROLE_REQUIRED') return null
    throw safeError(error)
  }
  const parsed = staffRoleSchema.safeParse(data)
  if (!parsed.success) throw new ModerationApiError('UNAVAILABLE')
  return parsed.data
}

export async function listModerationQueue(limit: number): Promise<ModerationQueueItem[]> {
  const { data, error } = await supabase.rpc('list_moderation_queue', { p_limit: limit })
  if (error) throw safeError(error)
  const rows = parseContract(z.array(moderationQueueRpcRowSchema), data ?? [])
  return rows.map((row) => {
    return parseContract(moderationQueueItemSchema, {
    eventId: row.event_id, moderationStatus: row.moderation_status, contentRevision: row.content_revision,
    inputSha256: row.input_sha256, moderationVersion: row.moderation_version,
    publicHistoryStatus: row.public_history_status, queuedEvaluationCount: row.queued_evaluation_count,
    oldestQueuedAt: row.oldest_queued_at,
    })
  })
}

export async function getModerationCase(eventId: string): Promise<ModerationCase | null> {
  const { data, error } = await supabase.rpc('get_moderation_case', { p_event_id: eventId })
  if (error) {
    if (safeError(error).code === 'NOT_FOUND') return null
    throw safeError(error)
  }
  const row = parseOne(moderationCaseRpcRowSchema, data)
  return row === null ? null : moderationCaseFromRpc(row)
}

export async function submitModerationAction(input: ModerationActionInput): Promise<string> {
  const values = moderationActionInputSchema.parse(input)
  const { data, error } = await supabase.rpc('moderate_event', {
    p_event_id: values.eventId, p_expected_content_revision: values.expectedContentRevision,
    p_expected_input_sha256: values.expectedInputSha256, p_expected_moderation_version: values.expectedModerationVersion,
    p_action: values.action, p_reason_code: values.reasonCode, p_internal_note: values.internalNote,
  })
  if (error) throw safeError(error)
  const parsed = z.string().uuid().safeParse(data)
  if (!parsed.success) throw new ModerationApiError('UNAVAILABLE')
  return parsed.data
}

const publicEventRpcSchema = z.strictObject({
  id: z.string().uuid(), title: z.string(), description: z.string(), category: z.string(), starts_at: z.string(), ends_at: z.string(), timezone: z.string(),
  venue_name: z.string(), address_line1: z.string(), address_line2: z.string().nullable(), city: z.string(), region: z.string(), postal_code: z.string(), country_code: z.string(),
  latitude: z.number(), longitude: z.number(), artwork_path: z.string().nullable(), animation_preset: z.string(), admission_type: z.string(), minimum_age: z.string(),
  advisories: z.array(z.string()), organizer: z.strictObject({ id: z.string().uuid(), display_name: z.string() }),
})

export async function getPublicEvent(eventId: string) {
  const { data, error } = await supabase.rpc('get_public_event', { p_event_id: eventId })
  if (error) throw new ModerationApiError('UNAVAILABLE')
  const row = parseOne(publicEventRpcSchema, data)
  if (row === null) return null
  return parseContract(publicEventSchema, {
    id: row.id, title: row.title, description: row.description, category: row.category, startsAt: row.starts_at, endsAt: row.ends_at,
    timezone: row.timezone, venueName: row.venue_name, addressLine1: row.address_line1, addressLine2: row.address_line2,
    city: row.city, region: row.region, postalCode: row.postal_code, countryCode: row.country_code, latitude: row.latitude, longitude: row.longitude,
    artworkPath: row.artwork_path, animationPreset: row.animation_preset, admissionType: row.admission_type,
    minimumAge: row.minimum_age, advisories: row.advisories, organizer: { id: row.organizer.id, displayName: row.organizer.display_name },
  })
}

const reportResponseSchema = z.strictObject({ status: z.literal('received') })
export async function reportPublicEvent(eventId: string, reason: ReportReason): Promise<{ status: 'received' }> {
  const parsedReason = reportReasonSchema.parse(reason)
  const { data, error } = await supabase.functions.invoke('report-event', { body: { eventId, reason: parsedReason } })
  if (error) throw new ModerationApiError('UNAVAILABLE')
  const parsed = reportResponseSchema.safeParse(data)
  if (!parsed.success) throw new ModerationApiError('UNAVAILABLE')
  return parsed.data
}
