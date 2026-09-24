import { z } from "zod";
import { canonicalEmail } from "./ticketEmailAccess.ts";
import { validEmailTimestamp } from "./ticketEmailProvider.ts";
import { emailRenderer } from "../../../src/features/ticket-experience/email/renderEmail.ts";

const unicode = (value: string) =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
    .test(value);
const unsafeControls = (value: string, body = false) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return (code < 32 && !(body && (code === 9 || code === 10))) ||
      code === 127;
  });
const length = (value: string, max: number) =>
  Array.from(value).length >= 1 && Array.from(value).length <= max;
export const messageSubjectSchema = z.string().transform((value) =>
  value.replace(/^ +| +$/g, "")
).refine((value) =>
  unicode(value) && length(value, 120) && !unsafeControls(value)
);
export const messageBodySchema = z.string().transform((value) =>
  value.replace(/\r\n?/g, "\n").replace(/^[ \t\n]+|[ \t\n]+$/g, "")
).refine((value) =>
  unicode(value) && length(value, 5000) &&
  !unsafeControls(value, true)
);
const selector = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("everyone") }).strict(),
  ...(["tier", "order", "registration"] as const).map((kind) =>
    z.object({ kind: z.literal(kind), id: z.uuid() }).strict()
  ),
]);
const fields = {
  eventId: z.uuid(),
  selector,
  subject: messageSubjectSchema,
  body: messageBodySchema,
};
export const organizerMessageRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("options"), eventId: z.uuid() }).strict(),
  z.object({ action: z.literal("preview"), ...fields }).strict(),
  z.object({
    action: z.literal("submit"),
    ...fields,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.uuid(),
  }).strict(),
  z.object({
    action: z.literal("receipt"),
    eventId: z.uuid(),
    requestId: z.uuid(),
  }).strict(),
]);
export const messageTimestampSchema = z.string().refine(validEmailTimestamp);
export const organizerMessageFactsSchema = z.object({
  eventId: z.uuid(),
  eventName: z.string().min(1).max(500),
  organizerName: z.string().max(500),
  startsAt: messageTimestampSchema,
  endsAt: messageTimestampSchema,
  timezone: z.string().min(1).max(100),
  venueName: z.string().min(1).max(500),
  senderEmail: z.string().refine(canonicalEmail),
  replyTo: z.string().refine(canonicalEmail),
  templateVersion: z.literal("organizer-message-v1"),
  eventUrl: z.string().nullable(),
  flyerUrl: z.string().nullable(),
  organizerLogoUrl: z.string().nullable(),
}).strict().refine((f) => Date.parse(f.endsAt) > Date.parse(f.startsAt));
export const organizerMessageReceiptSchema = z.object({
  messageId: z.uuid(),
  requestId: z.uuid(),
  queuedRecipients: z.number().int().positive(),
  confirmedAt: messageTimestampSchema,
}).strict();
export const organizerMessageOptionsSchema = z.object({
  eventId: z.uuid(),
  admissionType: z.enum(["paid", "free"]),
  deadline: messageTimestampSchema.nullable(),
  canSend: z.boolean(),
  reason: z.string().nullable(),
  replyTo: z.string().nullable(),
  tiers: z.array(
    z.object({ id: z.uuid(), name: z.string(), archived: z.boolean() })
      .strict(),
  ),
}).strict();
export const organizerMessagePreviewSchema = z.object({
  recipientCount: z.number().int().nonnegative(),
  canSend: z.boolean(),
  reason: z.string().nullable(),
  audienceLabel: z.string(),
  deadline: messageTimestampSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  subject: messageSubjectSchema,
  body: messageBodySchema,
  facts: organizerMessageFactsSchema,
}).strict();
export const organizerMessageErrorCodes = new Set([
  "UNAUTHORIZED",
  "EVENT_UNAVAILABLE",
  "EVENT_CANCELLED",
  "EVENT_DRAFT",
  "MODERATION_BLOCKED",
  "INVALID_SCHEDULE",
  "SEND_WINDOW_CLOSED",
  "INVALID_SELECTOR",
  "INVALID_TIER",
  "INACTIVE_INDIVIDUAL",
  "AUDIENCE_UNAVAILABLE",
  "INVALID_SUBJECT",
  "INVALID_BODY",
  "NO_RECIPIENTS",
  "PREVIEW_CHANGED",
  "REQUEST_CONFLICT",
  "LIMIT_REACHED",
  "PREVIEW_LIMIT_REACHED",
  "EMAIL_UNAVAILABLE",
]);

function safeUrl(
  value: string | null,
  kind: "event" | "flyer" | "logo",
  eventId: string,
): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.hash) {
      return undefined;
    }
    if (kind === "event") {
      return u.pathname === `/events/${eventId}` && !u.search
        ? value
        : undefined;
    }
    const endpoint = kind === "flyer" ? "event-images" : "organizer-media";
    return u.pathname === `/functions/v1/${endpoint}` &&
        Array.from(u.searchParams.keys()).join() === "id" &&
        z.uuid().safeParse(u.searchParams.get("id")).success
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
export async function renderOrganizerMessage(
  rawFacts: unknown,
  subject: string,
  body: string,
): Promise<{ from: string; replyTo: string; html: string; text: string }> {
  const f = organizerMessageFactsSchema.parse(rawFacts);
  const safeName = f.organizerName.trim();
  const organizerName =
    safeName && unicode(safeName) && length(safeName, 120) &&
      !unsafeControls(safeName) && !/[<>"\\]/.test(safeName)
      ? safeName
      : "Event organizer";
  const startsAtLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: f.timezone,
  }).format(new Date(f.startsAt));
  const rendered = await emailRenderer.render({
    kind: "organizer_message",
    props: {
      subject: messageSubjectSchema.parse(subject),
      body: messageBodySchema.parse(body),
      organizerName,
      eventName: f.eventName,
      startsAtLabel,
      venueName: f.venueName,
      supportEmail: f.replyTo,
      eventUrl: safeUrl(f.eventUrl, "event", f.eventId),
      flyerUrl: safeUrl(f.flyerUrl, "flyer", f.eventId),
      organizerLogoUrl: safeUrl(f.organizerLogoUrl, "logo", f.eventId),
    },
  });
  const display = `${organizerName} via Wheretoo`;
  const senderLabel =
    Array.from(display).some((character) => "(),:;@[].".includes(character))
      ? `"${display}"`
      : display;
  return {
    ...rendered,
    from: `${senderLabel} <${f.senderEmail}>`,
    replyTo: f.replyTo,
  };
}
