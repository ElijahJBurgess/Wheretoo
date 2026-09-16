import { validEmailTimestamp } from "./emailTimestamp.ts";
export { validEmailTimestamp } from "./emailTimestamp.ts";
import { Resend } from "npm:resend@6.26.0";
import type { ProviderEmailPayload } from "./ticketEmailAccess.ts";

export type ProviderResult = { outcome: "accepted"; providerId: string } | {
  outcome: "failed" | "unknown";
};
export type ProviderDependencies = { apiKey: string; fetch: typeof fetch };

export async function sendProviderEmail(
  payload: ProviderEmailPayload,
  key: string,
  dependencies: ProviderDependencies,
): Promise<ProviderResult> {
  // No SDK retry layer: the database alone authorizes each bounded dispatch.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await dependencies.fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${dependencies.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({
        from: payload.from,
        to: payload.to,
        reply_to: payload.replyTo,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        tags: payload.tags,
      }),
    });
    if (response.ok) {
      const data: unknown = await response.json();
      if (record(data) && identifier(data.id)) {
        return { outcome: "accepted", providerId: data.id };
      }
      return { outcome: "unknown" };
    }
    await response.body?.cancel();
    // Conflict, throttling, server errors and transport failures are not evidence of non-acceptance.
    return {
      outcome: [400, 401, 403, 404, 422].includes(response.status)
        ? "failed"
        : "unknown",
    };
  } catch {
    return { outcome: "unknown" };
  } finally {
    clearTimeout(timeout);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ProviderObservation = {
  p_webhook_id: string;
  p_attempt_id: string;
  p_provider_id: string;
  p_kind: string;
  p_observed_at: string;
};

export async function verifyProviderObservation(
  raw: string,
  headers: Headers,
  secret: string,
): Promise<ProviderObservation> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!identifier(id) || !timestamp || !signature || !secret) {
    throw new Error("Invalid provider observation");
  }
  // Resend 6.26 delegates to Standard Webhooks verification; preserve the signed raw bytes.
  const value: unknown = new Resend("verification-only").webhooks.verify({
    payload: raw,
    headers: { id, timestamp, signature },
    webhookSecret: secret,
  });
  if (
    !record(value) || typeof value.type !== "string" ||
    !validEmailTimestamp(value.created_at) || !record(value.data)
  ) throw new Error("Invalid provider observation");
  const kind = value.type.startsWith("email.") ? value.type.slice(6) : "";
  const tags = value.data.tags;
  if (
    ![
      "sent",
      "delivered",
      "delivery_delayed",
      "bounced",
      "complained",
      "failed",
    ].includes(kind) || !identifier(value.data.email_id) || !record(tags) ||
    typeof tags.attempt_id !== "string" || !uuid.test(tags.attempt_id)
  ) throw new Error("Invalid provider observation");
  return {
    p_webhook_id: id,
    p_attempt_id: tags.attempt_id,
    p_provider_id: value.data.email_id,
    p_kind: kind,
    p_observed_at: value.created_at,
  };
}
