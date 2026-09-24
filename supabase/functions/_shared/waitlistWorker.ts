import { z } from "zod";
import {
  canonicalEmail,
  decryptEmailPayload,
  type EncryptedEmailPayload,
  encryptEmailPayload,
  type ProviderEmailPayload,
} from "./ticketEmailAccess.ts";
import type { EmailRpc } from "./ticketEmailWorker.ts";
import type { ProviderResult } from "./ticketEmailProvider.ts";
import {
  createWaitlistToken,
  renderWaitlistEmail,
  waitlistFactsSchema,
} from "./waitlistEmail.ts";
export type WaitlistWorkerDependencies = {
  config: { keyId: string; keys: ReadonlyMap<string, Uint8Array> } | null;
  rpc: EmailRpc;
  now: () => number;
  send: (payload: ProviderEmailPayload, key: string) => Promise<ProviderResult>;
};
const claimSchema = z.object({
  attemptId: z.uuid(),
  leaseId: z.uuid(),
  payload: z.unknown(),
}).strict();
const contextSchema = z.object({
  attemptId: z.uuid(),
  recipient: z.string().refine(canonicalEmail),
  purpose: z.enum(["confirmation", "restock"]),
  facts: waitlistFactsSchema,
  factsDigest: z.string().regex(/^[a-f0-9]{64}$/),
  payload: z.unknown(),
}).strict();
const dispatchSchema = z.object({
  attemptId: z.uuid(),
  payload: z.unknown(),
  idempotencyKey: z.string(),
  leaseUntil: z.string().datetime({ offset: true }),
  firstPossibleDispatchAt: z.string().datetime({ offset: true }),
  dispatchCount: z.number().int().positive(),
}).strict();
export async function processWaitlistDelivery(
  deps: WaitlistWorkerDependencies,
): Promise<string> {
  if (!deps.config || deps.config.keys.get(deps.config.keyId)?.length !== 32) {
    return "unavailable";
  }
  const config = deps.config;
  const raw = await deps.rpc("server_claim_waitlist_delivery");
  if (raw === null) return "empty";
  const parsed = claimSchema.safeParse(raw);
  if (!parsed.success) return "unavailable";
  const { attemptId, leaseId } = parsed.data;
  const args = { p_attempt_id: attemptId, p_lease_id: leaseId };
  const stop = async (reason: string) => {
    await deps.rpc("server_stop_waitlist_delivery", {
      ...args,
      p_reason: reason,
    });
    return reason;
  };
  const defer = async () => {
    await deps.rpc("server_defer_waitlist_delivery", args);
    return "blocked";
  };
  const rawContext = await deps.rpc("server_prepare_waitlist_delivery", args);
  if (rawContext === null) return await defer();
  const context = contextSchema.safeParse(rawContext);
  if (!context.success || context.data.attemptId !== attemptId) {
    return await stop("invalid_projection");
  }
  const c = context.data;
  const encryptionContext = {
    kind: "provider" as const,
    attemptId,
    grantId: null,
  };
  let envelope = c.payload;
  if (envelope == null) {
    let tokenHash: string;
    try {
      const token = await createWaitlistToken();
      const request: ProviderEmailPayload = {
        ...await renderWaitlistEmail(c.facts, c.purpose, token.token),
        to: c.recipient,
        tags: [{ name: "attempt_id", value: attemptId }],
      };
      envelope = await encryptEmailPayload(
        { kind: "provider", request },
        encryptionContext,
        config.keyId,
        config.keys.get(config.keyId)!,
      );
      tokenHash = token.hash;
    } catch {
      return await stop("invalid_projection");
    }
    // A failed response may hide a committed payload; keep the lease/bytes for reconciliation.
    if (
      await deps.rpc("server_save_waitlist_payload", {
        ...args,
        p_payload: envelope,
        p_token_hash: tokenHash,
        p_facts_digest: c.factsDigest,
      }) !== true
    ) return await defer();
  }
  let payload: ProviderEmailPayload;
  try {
    const saved = await decryptEmailPayload(
      envelope as EncryptedEmailPayload,
      encryptionContext,
      config.keys,
    );
    if (saved.kind !== "provider" || saved.request.to !== c.recipient) {
      throw Error();
    }
    payload = saved.request;
  } catch {
    return await stop("payload_unreadable");
  }
  const began = await deps.rpc("server_begin_waitlist_dispatch", args);
  if (began === null) return await defer();
  const finish = async (result: ProviderResult) =>
    await deps.rpc("server_finish_waitlist_dispatch", {
        ...args,
        p_outcome: result.outcome,
        p_provider_id: result.outcome === "accepted" ? result.providerId : null,
      }) === true
      ? result.outcome
      : "lease_lost";
  const dispatch = dispatchSchema.safeParse(began);
  if (
    !dispatch.success || dispatch.data.attemptId !== attemptId ||
    dispatch.data.idempotencyKey !== `waitlist/${attemptId}`
  ) return await finish({ outcome: "unknown" });
  try {
    const saved = await decryptEmailPayload(
      dispatch.data.payload as EncryptedEmailPayload,
      encryptionContext,
      config.keys,
    );
    if (
      saved.kind !== "provider" ||
      JSON.stringify(saved.request) !== JSON.stringify(payload)
    ) throw Error();
  } catch {
    return await finish({ outcome: "unknown" });
  }
  if (
    Date.parse(dispatch.data.leaseUntil) - deps.now() < 20000 ||
    deps.now() >=
      Date.parse(dispatch.data.firstPossibleDispatchAt) + 23 * 3600000 ||
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
