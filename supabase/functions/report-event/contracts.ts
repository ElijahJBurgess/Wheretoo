import { z } from "zod";

export const reportReasonSchema = z.enum([
  "scam_misleading",
  "unsafe",
  "prohibited_content",
  "wrong_location",
  "event_missing",
  "adult_misrepresented",
  "hate_extremism",
  "other",
]);

export const reportRequestSchema = z.object({
  eventId: z.string().uuid(),
  reason: reportReasonSchema,
}).strict();

export type ReportRequest = z.infer<typeof reportRequestSchema>;
export type ReportSubmissionDisposition =
  | "submitted"
  | "duplicate"
  | "rate_limited"
  | "not_found";

export interface ReportFingerprints {
  actorFingerprint: string;
  networkFingerprint: string;
}
