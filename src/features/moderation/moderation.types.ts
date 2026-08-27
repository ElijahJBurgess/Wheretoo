import type { z } from 'zod'
import type {
  agreementStatusSchema,
  eventRequirementsInputSchema,
  eventRequirementsSchema,
  moderationActionInputSchema,
  moderationCaseSchema,
  moderationQueueItemSchema,
  policyStageSchema,
  reportReasonSchema,
  requiredPolicySchema,
  staffRoleSchema,
} from './moderation.schemas'

export type PolicyStage = z.infer<typeof policyStageSchema>
export type RequiredPolicy = z.infer<typeof requiredPolicySchema>
export type EventRequirements = z.infer<typeof eventRequirementsSchema>
export type EventRequirementsInput = z.infer<typeof eventRequirementsInputSchema>
export type AgreementStatus = z.infer<typeof agreementStatusSchema>
export type ReportReason = z.infer<typeof reportReasonSchema>
export type ModerationActionInput = z.infer<typeof moderationActionInputSchema>
export type ModerationCase = z.infer<typeof moderationCaseSchema>
export type ModerationQueueItem = z.infer<typeof moderationQueueItemSchema>
export type StaffRole = z.infer<typeof staffRoleSchema>
