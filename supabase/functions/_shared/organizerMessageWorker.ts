import { z } from "zod";
import type { EmailRpc } from "./ticketEmailWorker.ts";
import {
  canonicalEmail,
  decryptEmailPayload,
  type EncryptedEmailPayload,
  encryptEmailPayload,
  type ProviderEmailPayload,
} from "./ticketEmailAccess.ts";
import type { ProviderResult } from "./ticketEmailProvider.ts";
import {
  messageBodySchema,
  messageSubjectSchema,
  messageTimestampSchema,
  organizerMessageFactsSchema,
  renderOrganizerMessage,
} from "./organizerMessage.ts";
export type OrganizerMessageWorkerConfig = {
  keyId: string;
  keys: ReadonlyMap<string, Uint8Array>;
};
export type OrganizerMessageWorkerDependencies = {
  config: OrganizerMessageWorkerConfig | null;
  rpc: EmailRpc;
  now: () => number;
  send: (payload: ProviderEmailPayload, key: string) => Promise<ProviderResult>;
};
const claimSchema = z.object({
  attemptId: z.uuid(),
  leaseId: z.uuid(),
  payload: z.unknown(),
}).strict();
const preparationSchema = z.object({
  attemptId: z.uuid(),
  messageId: z.uuid(),
  recipient: z.string().refine(canonicalEmail),
  subject: messageSubjectSchema,
  body: messageBodySchema,
  facts: organizerMessageFactsSchema,
  payload: z.unknown(),
}).strict();
const dispatchSchema = z.object({
  attemptId: z.uuid(),
  payload: z.unknown(),
  idempotencyKey: z.string(),
  leaseUntil: messageTimestampSchema,
  firstPossibleDispatchAt: messageTimestampSchema,
  dispatchCount: z.number().int().positive(),
}).strict();

export async function processOrganizerMessage(
  deps: OrganizerMessageWorkerDependencies,
): Promise<string> {
  if (!deps.config) return "unavailable";
  const config = deps.config;
  if (
    !config.keys.has(config.keyId) ||
    config.keys.get(config.keyId)!.length !== 32
  ) return "unavailable";
  const raw = await deps.rpc("server_claim_organizer_message_recipient");
  if (raw === null) return "empty";
  const claim = claimSchema.safeParse(raw);
  if (!claim.success) return "unavailable";
  const { attemptId, leaseId } = claim.data;
  const identity = { p_attempt_id: attemptId, p_lease_id: leaseId };
  const stop = async (reason: string) => {
    await deps.rpc("server_stop_organizer_message_recipient", {
      ...identity,
      p_reason: reason,
    });
    return reason;
  };
  const prepared = await deps.rpc(
    "server_prepare_organizer_message_recipient",
    identity,
  );
  if (prepared === null) return "lease_lost";
  const context = preparationSchema.safeParse(prepared);
  if (!context.success || context.data.attemptId !== attemptId) {
    return await stop("invalid_projection");
  }
  const encryptionContext = {
    kind: "provider" as const,
    attemptId,
    grantId: null,
  };
  let envelope = context.data.payload;
  if (envelope == null) {
    try {
      const c = context.data;
      const rendered = await renderOrganizerMessage(c.facts, c.subject, c.body);
      const request: ProviderEmailPayload = {
        to: c.recipient,
        subject: c.subject,
        ...rendered,
        tags: [{ name: "attempt_id", value: attemptId }],
      };
      envelope = await encryptEmailPayload(
        { kind: "provider", request },
        encryptionContext,
        config.keyId,
        config.keys.get(config.keyId)!,
      );
      if (
        await deps.rpc("server_save_organizer_message_payload", {
          ...identity,
          p_payload: envelope,
        }) !== true
      ) return "lease_lost";
    } catch {
      return await stop("invalid_projection");
    }
  }
  let payload: ProviderEmailPayload;
  try {
    const stored = await decryptEmailPayload(
      envelope as EncryptedEmailPayload,
      encryptionContext,
      config.keys,
    );
    if (
      stored.kind !== "provider" || stored.request.to !== context.data.recipient
    ) throw Error();
    payload = stored.request;
  } catch {
    return await stop("payload_unreadable");
  }
  // This transaction reserves capacity, rechecks suppression and persists possible dispatch first.
  const began = await deps.rpc(
    "server_begin_organizer_message_dispatch",
    identity,
  );
  if (began === null) return "dispatch_blocked";
  const finish = async (result: ProviderResult) =>
    await deps.rpc("server_finish_organizer_message_dispatch", {
        ...identity,
        p_outcome: result.outcome,
        p_provider_id: result.outcome === "accepted" ? result.providerId : null,
      }) === true
      ? result.outcome
      : "lease_lost";
  const dispatch = dispatchSchema.safeParse(began);
  if (
    !dispatch.success || dispatch.data.attemptId !== attemptId ||
    dispatch.data.idempotencyKey !== `organizer-message/${attemptId}`
  ) return await finish({ outcome: "unknown" });
  try {
    const authoritative = await decryptEmailPayload(
      dispatch.data.payload as EncryptedEmailPayload,
      encryptionContext,
      config.keys,
    );
    if (
      authoritative.kind !== "provider" ||
      JSON.stringify(authoritative.request) !== JSON.stringify(payload)
    ) throw Error();
  } catch {
    return await finish({ outcome: "unknown" });
  }
  const now = deps.now();
  if (
    Date.parse(dispatch.data.leaseUntil) - now < 20000 ||
    now >= Date.parse(dispatch.data.firstPossibleDispatchAt) + 23 * 3600000 ||
    dispatch.data.dispatchCount > 6
  ) return await finish({ outcome: "unknown" });
  let result: ProviderResult;
  try {
    result = await deps.send(payload, dispatch.data.idempotencyKey);
  } catch {
    result = { outcome: "unknown" };
  }
  if (result.outcome === "failed" && dispatch.data.dispatchCount > 1) {
    result = { outcome: "unknown" };
  }
  return await finish(result);
}
