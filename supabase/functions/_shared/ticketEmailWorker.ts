import { z } from "zod";
import {
  eventFinancialLabel,
  eventNoticeChanges,
  eventNoticeSourceSchema,
} from "./eventNotice.ts";
import { refundMoneyLabel, refundNoticeSourceSchema } from "./refundNotice.ts";
import { emailRenderer } from "../../../src/features/ticket-experience/email/renderEmail.ts";
import {
  canonicalEmail,
  createEmailGrant,
  decryptEmailPayload,
  type EncryptedEmailPayload,
  encryptEmailPayload,
  grantExpiresAt,
  type ProviderEmailPayload,
} from "./ticketEmailAccess.ts";
import {
  type ProviderResult,
  validEmailTimestamp,
} from "./ticketEmailProvider.ts";
import type { EnvReader } from "./env.ts";

export type TicketEmailWorkerConfig = {
  from: string;
  supportEmail: string;
  appOrigin: string;
  keyId: string;
  keys: ReadonlyMap<string, Uint8Array>;
};
export type EmailRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
export type TicketEmailWorkerDependencies = {
  config: TicketEmailWorkerConfig | null;
  now: () => number;
  rpc: EmailRpc;
  send: (payload: ProviderEmailPayload, key: string) => Promise<ProviderResult>;
};

export function readTicketEmailPayloadKeys(
  read: EnvReader,
): Pick<TicketEmailWorkerConfig, "keyId" | "keys"> {
  const keyId = read("TICKET_EMAIL_PAYLOAD_KEY_ID");
  const raw: unknown = JSON.parse(
    read("TICKET_EMAIL_PAYLOAD_KEYS_JSON") ?? "null",
  );
  if (
    !keyId || !/^[A-Za-z0-9_-]{1,128}$/.test(keyId) || raw === null ||
    typeof raw !== "object" || Array.isArray(raw)
  ) throw new Error("Email key configuration unavailable");
  const keys = new Map<string, Uint8Array>();
  for (const [id, value] of Object.entries(raw)) {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(id) || typeof value !== "string" ||
      !/^[A-Za-z0-9+/]{43}=$/.test(value)
    ) throw new Error("Email key configuration unavailable");
    const bytes = Uint8Array.from(
      atob(value),
      (character) => character.charCodeAt(0),
    );
    if (bytes.length !== 32 || btoa(String.fromCharCode(...bytes)) !== value) {
      throw new Error("Email key configuration unavailable");
    }
    keys.set(id, bytes);
  }
  if (!keys.has(keyId)) throw new Error("Email key configuration unavailable");
  return { keyId, keys };
}

const timestamp = z.string().refine(validEmailTimestamp);
const purpose = z.enum([
  "initial",
  "resend",
  "recovery",
  "refund_notice",
  "event_change",
  "event_cancellation",
]);
const claimSchema = z.object({
  id: z.uuid(),
  purpose,
  lease_id: z.uuid(),
  request_id: z.uuid().nullable().optional(),
  recovery_payload: z.unknown(),
});
const contextSchema = z.object({
  kind: z.literal("ready"),
  attemptId: z.uuid(),
  purpose,
  grantId: z.uuid(),
  preparedAt: timestamp,
  expiresAt: timestamp,
  scheduledEndAt: timestamp.nullable(),
  overflow: z.boolean(),
  sources: z.array(z.unknown()),
  payload: z.unknown(),
});
const admissionSchema = z.object({
  admissionLabel: z.string().min(1).max(200),
  position: z.number().int().positive(),
  status: z.enum(["valid", "used"]),
  usedAt: timestamp.nullable(),
}).refine((admission) =>
  admission.status === "used"
    ? admission.usedAt !== null
    : admission.usedAt === null
);
const sourceSchema = z.object({
  sourceKind: z.enum(["paid_order", "free_registration"]),
  sourceId: z.uuid(),
  eventId: z.uuid(),
  organizerId: z.uuid(),
  email: z.string().refine(canonicalEmail),
  recipientName: z.string().min(1).max(200),
  quantity: z.number().int().positive().max(200),
  eventName: z.string().min(1).max(500),
  startsAt: timestamp,
  endsAt: timestamp,
  timezone: z.string().min(1),
  venueName: z.string().min(1).max(500),
  eligible: z.literal(true),
  admissions: z.array(admissionSchema).min(1).max(200),
}).refine((source) =>
  source.quantity === source.admissions.length &&
  source.admissions.some((admission) => admission.status === "valid") &&
  source.admissions.every((admission, index) =>
    admission.position === index + 1
  ) && source.email === source.email.trim().toLowerCase() &&
  Date.parse(source.endsAt) > Date.parse(source.startsAt)
);
const dispatchSchema = z.object({
  attemptId: z.uuid(),
  grantId: z.uuid(),
  payload: z.unknown(),
  idempotencyKey: z.string(),
  leaseUntil: timestamp,
  firstPossibleDispatchAt: timestamp,
  dispatchCount: z.number().int().positive(),
});
function dateLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export async function processTicketEmail(
  deps: TicketEmailWorkerDependencies,
): Promise<string> {
  if (!deps.config) return "unavailable";
  const config = deps.config;
  const claimRaw = await deps.rpc("server_claim_ticket_email");
  if (claimRaw === null) return "empty";
  const parsedClaim = claimSchema.safeParse(claimRaw);
  if (!parsedClaim.success) return "unavailable";
  const claim = parsedClaim.data;
  const identity = { p_attempt_id: claim.id, p_lease_id: claim.lease_id };
  const stop = async (reason: string) => {
    await deps.rpc("server_stop_ticket_email", {
      ...identity,
      p_reason: reason,
    });
    return reason;
  };
  if (!z.email().safeParse(config.supportEmail).success) {
    return await stop("support_unconfigured");
  }
  let recoveryEmail: string | null = null;
  if (claim.purpose === "recovery") {
    try {
      if (!claim.request_id) throw new Error();
      const recovery = await decryptEmailPayload(
        claim.recovery_payload as EncryptedEmailPayload,
        { kind: "recovery_request", requestId: claim.request_id },
        config.keys,
      );
      if (recovery.kind !== "recovery_request") throw new Error();
      recoveryEmail = recovery.email;
    } catch {
      return await stop("payload_unreadable");
    }
  }
  const rawContext = await deps.rpc("server_prepare_ticket_email_context", {
    ...identity,
    p_recovery_email: recoveryEmail,
  });
  if (rawContext === null) return "lease_lost";
  if (
    typeof rawContext === "object" && "kind" in rawContext &&
    rawContext.kind === "suppressed"
  ) return "suppressed";
  const parsed = contextSchema.safeParse(rawContext);
  if (
    !parsed.success || parsed.data.attemptId !== claim.id ||
    parsed.data.purpose !== claim.purpose
  ) return await stop("invalid_projection");
  const context = parsed.data;
  const encryptionContext = {
    kind: "provider" as const,
    attemptId: claim.id,
    grantId: context.grantId,
  };
  if (context.payload == null) {
    try {
      const refund = context.purpose === "refund_notice"
        ? refundNoticeSourceSchema.parse(
          context.sources.length === 1 ? context.sources[0] : null,
        )
        : null;
      const notice = context.purpose === "event_change" ||
          context.purpose === "event_cancellation"
        ? eventNoticeSourceSchema.parse(
          context.sources.length === 1 ? context.sources[0] : null,
        )
        : null;
      if (notice && notice.purpose !== context.purpose) throw new Error();
      const sources = refund || notice
        ? []
        : context.sources.map((value) => sourceSchema.parse(value));
      if (
        context.purpose === "recovery" &&
        sources.some((source) => source.email !== recoveryEmail)
      ) throw new Error();
      if (
        !refund && !notice && (
          context.overflow
            ? context.purpose !== "recovery" || sources.length !== 0
            : sources.length === 0 || sources.length > 200 ||
              (context.purpose !== "recovery" && sources.length !== 1)
        )
      ) throw new Error();
      if (
        (context.purpose === "recovery" ||
            context.purpose === "refund_notice" ||
            context.purpose === "event_cancellation") !==
          (context.scheduledEndAt === null) ||
        ((refund || notice) && context.overflow)
      ) throw new Error();
      const expectedExpiry = grantExpiresAt(
        context.purpose,
        context.preparedAt,
        context.scheduledEndAt ?? undefined,
      );
      if (
        Date.parse(expectedExpiry) !== Date.parse(context.expiresAt) ||
        Date.parse(context.expiresAt) <= deps.now()
      ) throw new Error();
      const grant = await createEmailGrant();
      const viewTicketsUrl = `${config.appOrigin}/ticket-access#${grant.token}`;
      const noticeFacts = notice?.detail.facts;
      const content = notice
        ? notice.purpose === "event_cancellation"
          ? await emailRenderer.render({
            kind: "event_cancelled",
            props: {
              recipientLabel: notice.recipientName,
              eventName: noticeFacts?.title ?? "Your event",
              startsAtLabel: noticeFacts?.starts_at
                ? dateLabel(noticeFacts.starts_at, noticeFacts.timezone)
                : "Previous schedule unavailable",
              venueName: noticeFacts?.venue_name ??
                "Previous venue unavailable",
              viewStatusUrl: `${config.appOrigin}/event-status#${grant.token}`,
              financialStatusLabel: eventFinancialLabel(
                notice.detail.financialState,
              ),
              supportEmail: config.supportEmail,
              expiresAtLabel: dateLabel(
                context.expiresAt,
                noticeFacts?.timezone ?? "UTC",
              ),
            },
          })
          : await emailRenderer.render({
            kind: "event_changed",
            props: {
              recipientLabel: notice.recipientName,
              eventName: noticeFacts?.title ?? "Your event",
              viewStatusUrl: `${config.appOrigin}/event-status#${grant.token}`,
              financialStatusLabel: eventFinancialLabel(
                notice.detail.financialState,
              ),
              supportEmail: config.supportEmail,
              expiresAtLabel: dateLabel(
                context.expiresAt,
                noticeFacts?.timezone ?? "UTC",
              ),
              changes: eventNoticeChanges(
                notice.previousFacts,
                notice.detail.facts,
                dateLabel,
              ),
            },
          })
        : refund
        ? await emailRenderer.render({
          kind: "order_refunded",
          props: {
            recipientLabel: refund.recipientName,
            eventName: refund.order.eventName,
            orderNumber: refund.order.orderNumber,
            amountLabel: refundMoneyLabel(refund.order.refundAmountMinor),
            completedAtLabel: dateLabel(
              refund.order.completedAt,
              refund.order.timezone,
            ),
            expiresAtLabel: dateLabel(context.expiresAt, refund.order.timezone),
            viewOrderUrl: `${config.appOrigin}/refund-details#${grant.token}`,
            supportEmail: config.supportEmail,
          },
        })
        : context.purpose === "recovery"
        ? await emailRenderer.render({
          kind: "ticket_recovery",
          props: context.overflow
            ? {
              recipientLabel: "there",
              overflow: true,
              supportEmail: config.supportEmail,
            }
            : {
              recipientLabel: "there",
              collectionCount: sources.length,
              ticketCount: sources.reduce(
                (sum, source) => sum + source.quantity,
                0,
              ),
              viewTicketsUrl,
              supportEmail: config.supportEmail,
            },
        })
        : await emailRenderer.render({
          kind: "tickets_ready",
          props: {
            recipientLabel: sources[0].recipientName,
            eventName: sources[0].eventName,
            startsAtLabel: dateLabel(sources[0].startsAt, sources[0].timezone),
            venueName: sources[0].venueName,
            admissions: sources[0].admissions.map((admission) => ({
              admissionLabel: admission.admissionLabel,
              positionLabel: `Ticket ${admission.position} of ${
                sources[0].quantity
              }`,
              statusLabel: admission.status === "used" ? "Used" : "Valid",
              ...(admission.usedAt
                ? {
                  usedAtLabel: dateLabel(admission.usedAt, sources[0].timezone),
                }
                : {}),
            })),
            viewTicketsUrl,
            supportEmail: config.supportEmail,
            expiresAtLabel: dateLabel(context.expiresAt, sources[0].timezone),
          },
        });
      const request: ProviderEmailPayload = {
        from: config.from,
        to: notice?.email ?? refund?.email ?? recoveryEmail ?? sources[0].email,
        replyTo: config.supportEmail,
        subject: notice
          ? `${noticeFacts?.title ?? "Your event"} ${
            notice.purpose === "event_cancellation"
              ? "has been cancelled"
              : "has been updated"
          }`
          : refund
          ? `${refund.order.eventName} order refunded`
          : context.purpose === "recovery"
          ? "Your Whereto ticket access"
          : `${sources[0].eventName} tickets are ready`,
        ...content,
        tags: [{ name: "attempt_id", value: claim.id }],
      };
      const encrypted = await encryptEmailPayload(
        { kind: "provider", request },
        encryptionContext,
        config.keyId,
        config.keys.get(config.keyId)!,
      );
      const saved = await deps.rpc("server_save_ticket_email_payload", {
        ...identity,
        p_token_hash: grant.tokenHash,
        p_payload: encrypted,
      });
      if (saved !== true) return "lease_lost";
      context.payload = encrypted;
    } catch {
      return await stop("invalid_projection");
    }
  }
  // Decrypt before committing Sending so unreadable data cannot create a fictitious dispatch.
  let payload: ProviderEmailPayload;
  try {
    const stored = await decryptEmailPayload(
      context.payload as EncryptedEmailPayload,
      encryptionContext,
      config.keys,
    );
    if (stored.kind !== "provider") throw new Error();
    payload = stored.request;
  } catch {
    return await stop("payload_unreadable");
  }
  const began = await deps.rpc("server_begin_ticket_email_dispatch", identity);
  if (began === null) return "dispatch_blocked";
  const finish = async (result: ProviderResult) => {
    const persisted = await deps.rpc("server_finish_ticket_email_dispatch", {
      ...identity,
      p_outcome: result.outcome,
      p_provider_id: result.outcome === "accepted" ? result.providerId : null,
    });
    return persisted === true ? result.outcome : "lease_lost";
  };
  const dispatch = dispatchSchema.safeParse(began);
  if (
    !dispatch.success || dispatch.data.attemptId !== claim.id ||
    dispatch.data.grantId !== context.grantId ||
    dispatch.data.idempotencyKey !== `ticket-email/${claim.id}`
  ) return await finish({ outcome: "unknown" });
  // Bind dispatch's authoritative payload to the exact decrypted content, never a regenerated email.
  try {
    const stored = await decryptEmailPayload(
      dispatch.data.payload as EncryptedEmailPayload,
      encryptionContext,
      config.keys,
    );
    if (
      stored.kind !== "provider" ||
      JSON.stringify(stored.request) !== JSON.stringify(payload)
    ) return await finish({ outcome: "unknown" });
  } catch {
    return await finish({ outcome: "unknown" });
  }
  const current = deps.now();
  if (
    Date.parse(dispatch.data.leaseUntil) - current < 20_000 ||
    current >=
      Date.parse(dispatch.data.firstPossibleDispatchAt) + 23 * 3_600_000 ||
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
