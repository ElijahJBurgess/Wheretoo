import { z } from "zod";
import { canonicalEmail } from "./ticketEmailAccess.ts";
import { validEmailTimestamp } from "./emailTimestamp.ts";
const timestamp = z.string().refine(validEmailTimestamp);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const refundDetailSchema = z.strictObject({
  orderNumber: z.string().min(1).max(100),
  eventName: z.string().min(1).max(500),
  startsAt: timestamp,
  endsAt: timestamp,
  timezone: z.string().min(1),
  venueName: z.string().min(1).max(500),
  currency: z.literal("usd"),
  totalMinor: money,
  subtotalMinor: money,
  quantity: z.number().int().min(1).max(200),
  items: z.array(
    z.strictObject({
      tierName: z.string().min(1).max(200),
      quantity: z.number().int().positive(),
      subtotalMinor: money,
    }),
  ).min(1).max(10),
  refundAmountMinor: money,
  completedAt: timestamp,
  tickets: z.array(
    z.strictObject({
      id: z.uuid(),
      admissionLabel: z.string().min(1).max(200),
      status: z.enum(["used", "refunded"]),
      usedAt: timestamp.nullable(),
    }).refine((t) => (t.status === "used") === (t.usedAt !== null)),
  ).min(1).max(200),
}).refine((o) =>
  o.totalMinor > 0 && o.refundAmountMinor === o.totalMinor &&
  o.subtotalMinor <= o.totalMinor &&
  o.items.reduce((n, i) => n + i.quantity, 0) === o.quantity &&
  o.items.reduce((n, i) => n + i.subtotalMinor, 0) === o.subtotalMinor &&
  o.tickets.length === o.quantity &&
  new Set(o.tickets.map((t) => t.id)).size === o.quantity &&
  Date.parse(o.endsAt) > Date.parse(o.startsAt)
);
export const refundNoticeSourceSchema = z.strictObject({
  email: z.string().refine(canonicalEmail),
  recipientName: z.string().min(1).max(200),
  eligible: z.literal(true),
  order: refundDetailSchema,
});
export function refundMoneyLabel(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
    .format(amount / 100);
}
