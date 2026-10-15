import { z } from 'zod'

const coordinate = z.number().finite()
const pair = z.tuple([coordinate, coordinate])
const profile = z.strictObject({
  minZoom: coordinate.min(0).max(24), maxZoom: coordinate.min(0).max(24),
  stops: z.array(z.tuple([coordinate.min(0).max(24), coordinate.positive().max(4)])).min(2).max(6),
}).refine(p => p.minZoom < p.maxZoom && p.stops.every(([zoom], i) =>
  zoom >= p.minZoom && zoom <= p.maxZoom && (i === 0 || zoom > p.stops[i - 1][0])), 'Invalid zoom profile')

/** Schema 1 intentionally supports only the reviewed legacy circle envelope.
 * New geometry capabilities require a versioned contract, not executable JSON. */
export const iconMetadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  widthPx: z.number().int().min(1).max(1024), heightPx: z.number().int().min(1).max(1024),
  pixelRatio: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  contactPx: pair, anchor: z.literal('bottom'), selectedScale: coordinate.min(1).max(1.25),
  desktop: profile, mobile: profile,
  hit: z.strictObject({ kind: z.literal('legacy-css-circle'), radius: coordinate.min(22).max(64),
    translation: z.tuple([coordinate.min(-96).max(96), coordinate.min(-96).max(96)]),
    minTargetDiameter: z.literal(44) }),
  alignment: z.strictObject({ pitch: z.literal('viewport'), rotation: z.literal('viewport') }),
  collisionMode: z.literal('always-visible'), sdf: z.literal(false),
}).superRefine((m, ctx) => {
  if (m.contactPx[0] < 0 || m.contactPx[0] > m.widthPx || m.contactPx[1] < 0 || m.contactPx[1] > m.heightPx)
    ctx.addIssue({ code: 'custom', message: 'Contact outside artwork' })
  if ([m.desktop, m.mobile].some(p => p.stops.some(([, s]) => Math.max(m.widthPx, m.heightPx) / m.pixelRatio * s * m.selectedScale > 96)))
    ctx.addIssue({ code: 'custom', message: 'Displayed artwork exceeds 96 CSS pixels' })
})

export type IconMetadata = z.infer<typeof iconMetadataSchema>
export function iconOffset(m: IconMetadata): [number, number] {
  return [(m.widthPx / 2 - m.contactPx[0]) / m.pixelRatio, (m.heightPx - m.contactPx[1]) / m.pixelRatio]
}
