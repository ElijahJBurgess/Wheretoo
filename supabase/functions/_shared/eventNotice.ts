import { z } from "zod";
import { canonicalEmail } from "./ticketEmailAccess.ts";
import { validEmailTimestamp } from "./emailTimestamp.ts";
const timestamp = z.string().refine(validEmailTimestamp);
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
export const eventNoticeSourceSchema = z.strictObject({
  email: z.string().refine(canonicalEmail),
  recipientName: z.string().min(1).max(200),
  eligible: z.literal(true),
  purpose: z.enum(["event_change", "event_cancellation"]),
  detail: eventStatusDetailSchema,
  previousFacts: eventNoticeFactsSchema.nullable(),
}).refine((n) =>
  n.purpose === "event_cancellation"
    ? n.detail.eventStatus === "cancelled"
    : n.detail.eventStatus === "published" && n.detail.facts !== null &&
      n.detail.tickets.length > 0 &&
      (n.detail.financialState === "eligible" || n.detail.financialState === "not_applicable")
);
export function eventFinancialLabel(
  state: z.infer<typeof eventStatusDetailSchema>["financialState"],
): string {
  switch (state) {
    case "not_applicable":
      return "This is a free registration. No payment or refund applies.";
    case "completed":
      return "Your whole-order refund is confirmed.";
    case "processing":
    case "submitting":
      return "Your refund is processing. Completion is not yet confirmed.";
    case "unknown":
      return "Your refund status is unknown. Check your private status page for updates.";
    case "failed":
      return "Your refund needs attention. Completion is not confirmed.";
    case "review":
    case "ineligible":
      return "Your payment or refund is under review. No refund completion is confirmed.";
    case "eligible":
      return "No refund is recorded. Check your private status page for updates.";
  }
}

type Facts = z.infer<typeof eventNoticeFactsSchema>;
export function eventNoticeChanges(
  previous: Facts | null,
  current: Facts | null,
  dateLabel: (value: string, zone: string) => string,
): { label: string; previous: string; current: string }[] {
  const labels: { key: keyof Facts; label: string }[] = [
    { key: "title", label: "Event name" },
    { key: "description", label: "Description" },
    { key: "category", label: "Category" },
    { key: "starts_at", label: "Starts" },
    { key: "ends_at", label: "Ends" },
    { key: "timezone", label: "Time zone" },
    { key: "venue_name", label: "Venue" },
    { key: "address_line1", label: "Address" },
    { key: "address_line2", label: "Address details" },
    { key: "city", label: "City" },
    { key: "region", label: "Region" },
    { key: "postal_code", label: "Postal code" },
    { key: "country_code", label: "Country" },
    { key: "latitude", label: "Latitude" },
    { key: "longitude", label: "Longitude" },
    { key: "disclosures", label: "Entry requirements" },
  ];
  const format = (facts: Facts | null, key: keyof Facts): string => {
    if (!facts) return "Previous details unavailable";
    const value = facts[key];
    if (value === null) return "Not specified";
    if (key === "starts_at" || key === "ends_at") {
      return dateLabel(String(value), facts.timezone);
    }
    if (key === "disclosures" && facts.disclosures) {
      const d = facts.disclosures;
      return [
        d.minimum_age === "all_ages"
          ? "All ages"
          : d.minimum_age === "18_plus"
          ? "Ages 18+"
          : "Ages 21+",
        ...([
          ["alcohol_present", "Alcohol"],
          ["cannabis_present", "Cannabis"],
          ["explicit_adult_content", "Adult content"],
          ["gambling_present", "Gambling"],
          ["weapons_present", "Weapons"],
          ["high_risk_activity", "High-risk activity"],
        ] as const).filter(([k]) => d[k]).map(([, label]) =>
          label + " disclosed"
        ),
      ].join("; ");
    }
    return String(value);
  };
  return labels.filter(({ key }) =>
    !previous ||
    JSON.stringify(previous[key]) !== JSON.stringify(current?.[key])
  ).map(({ key, label }) => ({
    label,
    previous: format(previous, key),
    current: format(current, key),
  }));
}
