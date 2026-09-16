import { z } from "zod";
export const categories = [
  "food_drink",
  "music",
  "fitness",
  "art_culture",
  "shopping",
  "community",
  "nightlife",
  "other",
] as const;
export const discoveryRequestSchema = z.object({
  region: z.literal("sf_bay_area"),
  when: z.enum(["upcoming", "today", "weekend"]),
  category: z.enum(categories).optional(),
  admissionType: z.enum(["free", "paid"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();
const instant = z.string().datetime({ offset: true }).max(40);
const timezone = z.string().min(1).max(100).refine((v) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
});
const boundedText = (min: number, max: number) =>
  z.string().transform((v) => v.trim()).refine((v) => {
    const length = Array.from(v).length;
    return length >= min && length <= max;
  });
export const discoveryRowSchema = z.object({
  id: z.string().uuid(),
  title: boundedText(3, 120),
  category: z.enum(categories),
  admissionType: z.enum(["free", "paid"]),
  startsAt: instant,
  endsAt: instant,
  timezone,
  venueName: boundedText(0, 160).nullable(),
  city: boundedText(1, 500),
  artworkReference: z.null(),
  admission: z.object({
    state: z.literal("unknown"),
    minimumBuyerAmountMinor: z.null(),
    currency: z.null(),
  }).strict(),
}).strict().refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt));
export const discoveryEnvelopeSchema = z.object({
  items: z.array(z.unknown()).max(50),
  nextCursor: z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/).nullable(),
  window: z.object({
    start: instant,
    end: instant,
    timezone: z.literal("America/Los_Angeles"),
  }).strict().refine((v) => Date.parse(v.end) > Date.parse(v.start)),
  serverNow: instant,
}).strict();
// Invalid rows retain a null slot, never raw data. This preserves paging bounds
// and lets the browser quarantine rows without mistaking malformed pages for empty.
export const discoveryResponseSchema = discoveryEnvelopeSchema.extend({
  items: z.array(discoveryRowSchema.nullable()).max(50),
});
export type DiscoveryRequest = z.infer<typeof discoveryRequestSchema>;
export type DiscoveryResponse = z.infer<typeof discoveryResponseSchema>;
