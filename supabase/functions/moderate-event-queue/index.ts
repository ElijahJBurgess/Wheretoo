import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "../_shared/database.ts";
import {
  getContextualModerationConfig,
  getModerationWorkerToken,
} from "../_shared/env.ts";
import { jsonResponse } from "../_shared/http.ts";
import {
  type ApplyDisposition,
  type ContextualModerationResult,
  type FailureDisposition,
  type ModerationFailureCode,
  type ModerationJob,
  moderationJobSchema,
} from "./contracts.ts";
import {
  createContextualModerator,
  ModerationAdapterError,
} from "./moderator.ts";

const SAFE_FAILURE_CODES = new Set<ModerationFailureCode>([
  "MODERATOR_UNAVAILABLE",
  "MODERATOR_TIMEOUT",
  "MODERATOR_MALFORMED",
  "MODERATOR_REQUEST_FAILED",
]);

type SafeLog = (...values: unknown[]) => void;

export interface ModerationWorkerDependencies {
  workerToken: string;
  claimJob(): Promise<ModerationJob | null>;
  moderate(job: ModerationJob): Promise<ContextualModerationResult>;
  applyResult(
    job: ModerationJob,
    result: ContextualModerationResult,
  ): Promise<ApplyDisposition>;
  failJob(
    job: ModerationJob,
    code: ModerationFailureCode,
  ): Promise<FailureDisposition>;
  log: SafeLog;
}

async function bearerMatches(
  request: Request,
  expected: string,
): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) {
    return false;
  }
  const supplied = authorization.slice("Bearer ".length);
  const encoder = new TextEncoder();
  const [suppliedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(suppliedDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function dbJob(row: unknown): ModerationJob {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("MODERATION_JOB_INVALID");
  }
  const value = row as Record<string, unknown>;
  return moderationJobSchema.parse({
    evaluationId: value.evaluation_id,
    eventId: value.event_id,
    contentRevision: value.content_revision,
    inputSha256: value.input_sha256,
    queuedModerationVersion: value.queued_moderation_version,
    attemptCount: value.attempt_count,
    priorReasonCodes: value.prior_reason_codes,
    input: value.moderation_input,
  });
}

export function createDatabaseDependencies(
  client: SupabaseClient,
  workerToken: string,
  moderate: ModerationWorkerDependencies["moderate"],
  log: SafeLog = console.info,
): ModerationWorkerDependencies {
  return {
    workerToken,
    moderate,
    log,
    async claimJob() {
      const { data, error } = await client.rpc(
        "server_claim_moderation_evaluation",
        { p_worker_reference: "edge-worker" },
      );
      if (error !== null || !Array.isArray(data) || data.length > 1) {
        throw new Error("MODERATION_CLAIM_FAILED");
      }
      return data.length === 0 ? null : dbJob(data[0]);
    },
    async applyResult(job, result) {
      const { data, error } = await client.rpc(
        "server_apply_moderation_evaluation",
        {
          p_evaluation_id: job.evaluationId,
          p_content_revision: job.contentRevision,
          p_input_sha256: job.inputSha256,
          p_queued_moderation_version: job.queuedModerationVersion,
          p_outcome: result.outcome,
          p_risk_level: result.riskLevel,
          p_reason_codes: result.reasonCodes,
          p_provider_reference: result.providerReference,
          p_model_version: result.modelVersion,
        },
      );
      if (
        error !== null ||
        !["applied", "already_applied", "superseded"].includes(String(data))
      ) {
        throw new Error("MODERATION_APPLY_FAILED");
      }
      return data as ApplyDisposition;
    },
    async failJob(job, code) {
      const { data, error } = await client.rpc(
        "server_fail_moderation_evaluation",
        {
          p_evaluation_id: job.evaluationId,
          p_content_revision: job.contentRevision,
          p_input_sha256: job.inputSha256,
          p_queued_moderation_version: job.queuedModerationVersion,
          p_failure_code: code,
        },
      );
      if (
        error !== null ||
        !["retry_scheduled", "failed", "superseded"].includes(String(data))
      ) {
        throw new Error("MODERATION_FAILURE_PERSIST_FAILED");
      }
      return data as FailureDisposition;
    },
  };
}

export function createModerationWorkerHandler(
  dependencies: ModerationWorkerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") {
      return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);
    }
    if (!await bearerMatches(request, dependencies.workerToken)) {
      return jsonResponse({ error: { code: "AUTH_REQUIRED" } }, 401);
    }

    let job: ModerationJob | null = null;
    try {
      job = await dependencies.claimJob();
      if (job === null) return new Response(null, { status: 204 });
      const result = await dependencies.moderate(job);
      const disposition = await dependencies.applyResult(job, result);
      return jsonResponse({
        status: "processed",
        evaluationId: job.evaluationId,
        disposition,
      });
    } catch (error) {
      if (
        job !== null && error instanceof ModerationAdapterError &&
        SAFE_FAILURE_CODES.has(error.code)
      ) {
        try {
          const disposition = await dependencies.failJob(job, error.code);
          dependencies.log("moderation_worker_failure", {
            evaluationId: job.evaluationId,
            code: error.code,
            disposition,
          });
          return jsonResponse(
            { error: { code: error.code }, disposition },
            503,
          );
        } catch {
          // The response remains bounded even if durable failure recording fails.
        }
      }
      dependencies.log("moderation_worker_internal_error");
      return jsonResponse({ error: { code: "INTERNAL_ERROR" } }, 500);
    }
  };
}

function defaultDependencies(): ModerationWorkerDependencies {
  const workerToken = getModerationWorkerToken();
  const config = getContextualModerationConfig();
  const moderate = config === null
    ? () =>
      Promise.reject(
        new ModerationAdapterError("MODERATOR_UNAVAILABLE"),
      )
    : createContextualModerator(config);
  return createDatabaseDependencies(
    getServiceClient(),
    workerToken,
    moderate,
  );
}

export function handler(request: Request): Promise<Response> {
  return createModerationWorkerHandler(defaultDependencies())(request);
}

if (import.meta.main) Deno.serve(handler);
