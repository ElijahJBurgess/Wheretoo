import { z } from "zod";
import { createElement } from "react";
import { render } from "@react-email/render";
import { WaitlistEmail } from "./emails/WaitlistEmail.tsx";
import { canonicalEmail } from "./ticketEmailAccess.ts";
import { validEmailTimestamp } from "./emailTimestamp.ts";
export const waitlistFactsSchema = z.object({
  eventId: z.uuid(),
  eventName: z.string().min(1).max(500),
  tierName: z.string().min(1).max(80),
  amountMinor: z.number().int().positive(),
  currency: z.literal("usd"),
  startsAt: z.string().refine(validEmailTimestamp),
  endsAt: z.string().refine(validEmailTimestamp),
  timezone: z.string().min(1),
  venueName: z.string().min(1).max(500),
  senderEmail: z.string().refine(canonicalEmail),
  replyTo: z.string().refine(canonicalEmail),
  eventUrl: z.string(),
  appOrigin: z.string(),
}).strict().refine((f) => {
  try {
    const u = new URL(f.appOrigin);
    return u.protocol === "https:" && u.origin === f.appOrigin &&
      f.eventUrl === `${f.appOrigin}/events/${f.eventId}/tickets` &&
      Date.parse(f.endsAt) > Date.parse(f.startsAt) &&
      !!new Intl.DateTimeFormat("en", { timeZone: f.timezone });
  } catch {
    return false;
  }
});
export async function hashWaitlistToken(token: string): Promise<string> {
  if (!/^wl1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(token)) {
    throw Error("Invalid token");
  }
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`wheretoo:waitlist-leave:v1\n${token}`),
  );
  return Array.from(
    new Uint8Array(bytes),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function createWaitlistToken() {
  const token = "wl1_" +
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return { token, hash: await hashWaitlistToken(token) };
}
export async function renderWaitlistEmail(
  f: z.infer<typeof waitlistFactsSchema>,
  purpose: "confirmation" | "restock",
  token: string,
) {
  await hashWaitlistToken(token);
  const subject = purpose === "confirmation"
    ? `You’re on the waitlist for ${f.tierName} — ${f.eventName}`
    : `${f.tierName} tickets are available again for ${f.eventName}`;
  const date = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: f.timezone,
  }).format(new Date(f.startsAt));
  const price = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(f.amountMinor / 100);
  const element = createElement(WaitlistEmail, {
    purpose,
    subject,
    eventName: f.eventName,
    tierName: f.tierName,
    date,
    venue: f.venueName,
    price,
    eventUrl: f.eventUrl,
    leaveUrl: `${f.appOrigin}/waitlist/leave#${token}`,
  });
  return {
    subject,
    from: `Wheretoo <${f.senderEmail}>`,
    replyTo: f.replyTo,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}
