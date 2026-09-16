import { z } from "zod";

export const moderationReasonCodeSchema = z.enum([
  "adult_explicit",
  "weapons",
  "gambling",
  "hate_extremism",
  "scam_misleading",
  "unsafe_activity",
  "location_invalid",
  "age_mismatch",
  "disclosure_mismatch",
  "user_report",
  "no_violation",
  "other",
]);

const nullableText = z.string().nullable();
const opaqueProviderMetadataSchema = z.string().regex(
  /^sha256:[a-f0-9]{64}$/,
  "provider metadata must be a server-derived digest",
);

const canonicalInputSchema = z.object({
  event: z.object({
    title: nullableText,
    description: nullableText,
    category: nullableText,
    venue_name: nullableText,
    starts_at: nullableText,
    ends_at: nullableText,
    timezone: nullableText,
    address_line1: nullableText,
    address_line2: nullableText,
    city: nullableText,
    region: nullableText,
    postal_code: nullableText,
    country_code: nullableText,
    mapbox_feature_id: nullableText,
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    admission_type: z.enum(["free", "paid"]),
  }).strict(),
  disclosures: z.object({
    minimum_age: z.enum(["all_ages", "18_plus", "21_plus"]),
    alcohol_present: z.boolean(),
    cannabis_present: z.boolean(),
    explicit_adult_content: z.boolean(),
    gambling_present: z.boolean(),
    weapons_present: z.boolean(),
    high_risk_activity: z.boolean(),
  }).strict(),
  artwork: z.object({
    path: nullableText,
    verification_state: z.enum(["not_present", "unverified"]),
  }).strict(),
  ticket_tiers: z.array(
    z.object({
      name: z.string().nullable(),
      description: z.string().nullable(),
    }).strict(),
  ).max(3),
  organizer_display_name: nullableText,
}).strict();

export const moderationClaimEnvelopeSchema = z.object({
  evaluationId: z.string().uuid(),
  eventId: z.string().uuid(),
  contentRevision: z.number().int().positive(),
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  queuedModerationVersion: z.number().int().nonnegative(),
  attemptCount: z.number().int().min(1).max(3),
  priorReasonCodes: z.array(moderationReasonCodeSchema).max(12),
}).strict();

export const moderationJobSchema = moderationClaimEnvelopeSchema.extend({
  input: canonicalInputSchema,
});

const moderationResultShape = {
  outcome: z.enum([
    "clear_candidate",
    "review_required",
    "prohibited_candidate",
  ]),
  riskLevel: z.enum(["low", "high"]),
  reasonCodes: z.array(moderationReasonCodeSchema).min(1).max(12),
};

type ModerationResultSemantics = {
  outcome: "clear_candidate" | "review_required" | "prohibited_candidate";
  riskLevel: "low" | "high";
  reasonCodes: Array<z.infer<typeof moderationReasonCodeSchema>>;
};

type RefinementContext = {
  addIssue(issue: { code: "custom"; message: string }): void;
};

function validateResultSemantics(
  value: ModerationResultSemantics,
  context: RefinementContext,
): void {
  if (
    value.outcome === "clear_candidate" &&
    (value.riskLevel !== "low" || value.reasonCodes.length !== 1 ||
      value.reasonCodes[0] !== "no_violation")
  ) {
    context.addIssue({
      code: "custom",
      message: "clear candidates must be low risk with no_violation",
    });
  }
  if (value.outcome !== "clear_candidate" && value.riskLevel !== "high") {
    context.addIssue({
      code: "custom",
      message: "held candidates must be high risk",
    });
  }
  if (
    value.outcome !== "clear_candidate" &&
    value.reasonCodes.includes("no_violation")
  ) {
    context.addIssue({
      code: "custom",
      message: "held candidates cannot include no_violation",
    });
  }
  if (new Set(value.reasonCodes).size !== value.reasonCodes.length) {
    context.addIssue({
      code: "custom",
      message: "reason codes must be unique",
    });
  }
}

export const contextualModerationProviderResultSchema = z.object({
  ...moderationResultShape,
  providerReference: z.string().min(1).max(255).nullable(),
  modelVersion: z.string().min(1).max(120).nullable(),
}).strict().superRefine(validateResultSemantics);

export const contextualModerationResultSchema = z.object({
  ...moderationResultShape,
  providerReference: opaqueProviderMetadataSchema.nullable(),
  modelVersion: opaqueProviderMetadataSchema.nullable(),
}).strict().superRefine(validateResultSemantics);

export type ModerationClaimEnvelope = z.infer<
  typeof moderationClaimEnvelopeSchema
>;
export type ModerationJob = z.infer<typeof moderationJobSchema>;
export type ModerationClaimResult =
  | { kind: "ready"; job: ModerationJob }
  | { kind: "invalid_input"; envelope: ModerationClaimEnvelope };
export type RejectionDisposition =
  | "superseded"
  | "not_found"
  | "conflict"
  | "schema_disagreement";
export type ContextualModerationResult = z.infer<
  typeof contextualModerationResultSchema
>;

export type ModerationFailureCode =
  | "MODERATOR_UNAVAILABLE"
  | "MODERATOR_TIMEOUT"
  | "MODERATOR_MALFORMED"
  | "MODERATOR_REQUEST_FAILED";

export type ApplyDisposition = "applied" | "already_applied" | "superseded";
export type FailureDisposition = "retry_scheduled" | "failed" | "superseded";
