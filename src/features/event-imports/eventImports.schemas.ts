import { z } from "zod";
export const importBatchSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  state: z.string(),
  row_count: z.number(),
  created_at: z.string(),
  error_code: z.string().nullable(),
  destination_organizer_id: z.string().uuid(),
});
export const importRowSchema = z.object({
  id: z.string(),
  record_number: z.number(),
  state: z.enum([
    "pending",
    "geocoding",
    "ready",
    "needs_review",
    "invalid",
    "duplicate_possible",
    "skipped",
    "imported",
    "failed",
  ]),
  revision: z.number(),
  input: z.object({
    title: z.string(),
    start_date: z.string(),
    start_time: z.string(),
    venue_name: z.string(),
    address: z.string(),
    category: z.string(),
    capacity: z.number().nullable(),
  }),
  errors: z.array(
    z.object({ field: z.string(), code: z.string(), message: z.string() }),
  ),
  duplicate_candidates: z.array(
    z.object({ id: z.string(), title: z.string(), kind: z.string() }),
  ),
  duplicate_count: z.number(),
  duplicate_digest: z.string().nullable(),
  resulting_event_id: z.string().nullable(),
  failure_code: z.string().nullable(),
});
export const importDetailSchema = z.object({
  batch: importBatchSchema,
  isOwner: z.boolean(),
  counts: z.record(z.string(), z.number()),
  rows: z.array(importRowSchema),
});
export type ImportRow = z.infer<typeof importRowSchema>;
export type ImportDetail = z.infer<typeof importDetailSchema>;
export type ImportAction =
  | { operation: "continue" | "cancel"; batchId: string }
  | { operation: "skip" | "retry"; batchId: string; rowId: string }
  | {
    operation: "override_duplicate";
    batchId: string;
    rowId: string;
    digest: string;
  }
  | {
    operation: "select_import";
    batchId: string;
    rows: {
      rowId: string;
      expectedRevision: number;
      expectedDuplicateDigest: string;
    }[];
  };
