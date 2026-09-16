// Mirrors the strict private allowlist in supabase/functions/_shared/eventNotice.ts.
import { z } from 'zod'
const timestamp = z.string().datetime({ offset: true })
const count = z.number().int().nonnegative().safe();
const text = z.string().max(20000).nullable();
export const eventNoticeFactsSchema = z.strictObject({
  title: text,
  description: text,
  category: text,
  starts_at: timestamp.nullable(),
  ends_at: timestamp.nullable(),
  timezone: z.string().min(1).max(100),
  venue_name: text,
  address_line1: text,
  address_line2: text,
  city: text,
  region: text,
  postal_code: text,
  country_code: text,
  mapbox_feature_id: text,
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  admission_type: z.enum(["free", "paid"]),
  capacity: count.nullable(),
  disclosures: z.strictObject({
    minimum_age: z.enum(["all_ages", "18_plus", "21_plus"]),
    alcohol_present: z.boolean(),
    cannabis_present: z.boolean(),
    explicit_adult_content: z.boolean(),
    gambling_present: z.boolean(),
    weapons_present: z.boolean(),
    high_risk_activity: z.boolean(),
  }).nullable(),
});
export const eventStatusDetailSchema = z.strictObject({
  sourceKind: z.enum(["paid_order", "free_registration"]),
  eventStatus: z.enum(["draft", "published", "cancelled"]),
  facts: eventNoticeFactsSchema.nullable(),
  quantity: count.min(1).max(200),
  orderNumber: z.string().min(1).max(100).nullable(),
  financialState: z.enum([
    "eligible",
    "submitting",
    "processing",
    "unknown",
    "failed",
    "review",
    "completed",
    "ineligible",
    "not_applicable",
  ]),
  totalMinor: count.nullable(),
  tickets: z.array(
    z.strictObject({
      id: z.uuid(),
      admissionLabel: z.string().min(1).max(200),
      status: z.enum(["valid", "used", "refunded", "cancelled"]),
      usedAt: timestamp.nullable(),
    }).refine((t) => (t.status === "used") === (t.usedAt !== null)),
  ).max(200),
  canViewTickets: z.boolean(),
}).refine((d) =>
  d.sourceKind === "free_registration"
    ? d.financialState === "not_applicable" && d.totalMinor === null &&
      d.orderNumber === null && d.tickets.length === d.quantity
    : d.financialState !== "not_applicable" && d.totalMinor !== null &&
      d.totalMinor > 0 && d.orderNumber !== null &&
      (d.tickets.length === d.quantity ||
        (d.financialState === "review" && d.tickets.length === 0 &&
          !d.canViewTickets))
)
  .refine((d) =>
    !d.canViewTickets ||
    (d.eventStatus === "published" &&
      d.tickets.some((t) => t.status === "valid") && d.facts !== null)
  )
  .refine((d) =>
    d.eventStatus !== "cancelled" ||
    d.tickets.every((t) => t.status !== "valid")
  );
export const eventStatusAccessSchema = z.strictObject({
  kind: z.literal("ready"),
  purpose: z.enum(["event_change", "event_cancellation"]),
  expiresAt: timestamp,
  detail: eventStatusDetailSchema,
})
  .refine((v) =>
    v.purpose !== "event_cancellation" || !v.detail.canViewTickets
  );

export type EventStatusAccess = z.infer<typeof eventStatusAccessSchema>
export type EventFacts = z.infer<typeof eventNoticeFactsSchema>
