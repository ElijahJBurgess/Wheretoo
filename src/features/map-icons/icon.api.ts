import { z } from 'zod'
import { iconMetadataSchema } from './icon.schemas'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const descriptorSchema = z.strictObject({
  versionId: z.uuid(), iconId: z.uuid(), name: z.string().min(1).max(100),
  packageHash: hash, pngSha256: hash, runtimeObjectKey: z.string(),
  byteSize: z.number().int().positive().max(1048576), metadata: iconMetadataSchema,
}).refine(d => d.runtimeObjectKey === `icons/${d.iconId}/${d.versionId}/${d.pngSha256}.png`)
const envelope = z.strictObject({ catalogRevision: z.number().int().nonnegative(), renderingEnabled: z.boolean(), versions: z.array(z.unknown()).max(64) })
export type IconDescriptor = z.infer<typeof descriptorSchema> & { url: string }
export type IconRpc = (name: 'get_public_map_icon_versions', args: { p_ids: string[] }) => PromiseLike<{ data: unknown; error: unknown }>

export function parseIconResponse(data: unknown, requested: readonly string[], configuredOrigin: string): IconDescriptor[] {
  const parsed = envelope.safeParse(data)
  if (!parsed.success || !parsed.data.renderingEnabled) return []
  const origin = new URL(configuredOrigin)
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname)))) return []
  const allowed = new Set(requested)
  const versions = new Map<string, IconDescriptor>()
  for (const raw of parsed.data.versions) {
    const result = descriptorSchema.safeParse(raw)
    if (!result.success || !allowed.has(result.data.versionId)) continue
    const d = result.data
    versions.set(d.versionId, { ...d, url: `${origin.origin}/storage/v1/object/public/map-icon-published/${d.runtimeObjectKey}` })
  }
  return [...versions.values()]
}

export async function resolveMapIcons(ids: readonly string[], rpc: IconRpc, origin: string): Promise<IconDescriptor[]> {
  const unique = [...new Set(ids)].filter(id => z.uuid().safeParse(id).success)
  const result: IconDescriptor[] = []
  // Bounded sequential metadata batches: image downloads have their own four-request budget.
  for (let offset = 0; offset < unique.length; offset += 64) {
    const batch = unique.slice(offset, offset + 64)
    try {
      const response = await rpc('get_public_map_icon_versions', { p_ids: batch })
      if (!response.error) {
        const availability = envelope.safeParse(response.data)
        if (availability.success && !availability.data.renderingEnabled) return []
        result.push(...parseIconResponse(response.data, batch, origin))
      }
    } catch { /* A failed batch keeps ordinary markers; never remove events. */ }
  }
  return result
}
