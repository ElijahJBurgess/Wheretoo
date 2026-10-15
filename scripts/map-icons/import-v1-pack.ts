import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { iconMetadataSchema } from '../../src/features/map-icons/icon.schemas'
import { assertLocalIconTarget } from './import-flag'

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const manifestSchema = z.object({ icons: z.array(z.object({
  filename: z.string().regex(/^[a-z-]+\.png$/), width: z.number().int().min(1).max(1024),
  height: z.number().int().min(1).max(1024), size_bytes: z.number().int().min(1).max(1048576),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), source_filename: z.string(),
  source_sha256: z.string().regex(/^[a-f0-9]{64}$/), ground_contact_point: z.tuple([z.number(), z.number()]),
})).length(9) })
export const approvedPack = manifestSchema.parse(JSON.parse(readFileSync(new URL('./v1-pack.json', import.meta.url), 'utf8')))
type PackIcon = typeof approvedPack.icons[number]
const archiveHash = '50994df778200cfe3855f5a03be04578a6bdfa235683ff42e32587cde97317ea'
const names: Record<string, string> = {
  'wheretoo-flag': 'Wheretoo Flag', 'markets-popups': 'Markets & Pop-ups', 'food-beverage': 'Food & Beverage',
  'dj-music': 'DJ & Music', 'live-performance': 'Live Performance', 'party-nightlife': 'Party & Nightlife',
  fitness: 'Fitness', 'art-creative': 'Art & Creative', 'community-festival': 'Community & Festival',
}

export function metadataForIcon(icon: PackIcon) {
  const longest = Math.max(icon.width, icon.height)
  const scale = (css: number) => css * 3 / longest
  const [x, y] = icon.ground_contact_point
  return iconMetadataSchema.parse({
    schemaVersion: 1, widthPx: icon.width, heightPx: icon.height, pixelRatio: 3,
    contactPx: [x, y], anchor: 'bottom', selectedScale: 1.08,
    desktop: { minZoom: 14.5, maxZoom: 24, stops: [[14.5, scale(48)], [15.25, scale(72)], [16.25, scale(88)]] },
    mobile: { minZoom: 14.5, maxZoom: 24, stops: [[14.5, scale(48)], [15.25, scale(64)], [16.25, scale(80)]] },
    hit: { kind: 'legacy-css-circle', radius: 44,
      translation: [(icon.width / 2 - x) * 88 / longest, (icon.height / 2 - y) * 88 / longest], minTargetDiameter: 44 },
    alignment: { pitch: 'viewport', rotation: 'viewport' }, collisionMode: 'always-visible', sdf: false,
  })
}

export function iconRequestId(icon: PackIcon) {
  const bytes = createHash('sha256').update(JSON.stringify([icon.sha256, metadataForIcon(icon)])).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function verifyPreparedIcon(icon: PackIcon, source: Buffer, runtime: Buffer) {
  if (sha(source) !== icon.source_sha256 || sha(runtime) !== icon.sha256) throw new Error(`Approved hash mismatch: ${icon.filename}`)
  if (runtime.length !== icon.size_bytes || runtime.length > 1048576
    || runtime.readUInt32BE(16) !== icon.width || runtime.readUInt32BE(20) !== icon.height
    || runtime[24] !== 8 || runtime[25] !== 6) throw new Error(`Invalid runtime PNG: ${icon.filename}`)
  const pixels = execFileSync('magick', ['-limit', 'memory', '128MiB', '-limit', 'map', '0', '-limit', 'disk', '0',
    'png:-', '-depth', '8', 'rgba:-'], { input: runtime, maxBuffer: 5 * 1024 * 1024, timeout: 15000 })
  if (pixels.length !== icon.width * icon.height * 4) throw new Error('Unexpected decoded dimensions')
  // The prepared export is the approved ingestion source, with an identity crop.
  // Upstream source art remains unchanged in the ZIP and is hash-pinned above.
  return { originalSha256: icon.sha256, pngSha256: icon.sha256, rgbaSha256: sha(pixels),
    originalBytes: runtime.length, runtimeBytes: runtime.length, originalWidth: icon.width, originalHeight: icon.height,
    crop: { x: 0, y: 0, width: icon.width, height: icon.height } }
}

export function readApprovedPack(archive: string) {
  const file = resolve(archive)
  if (statSync(file).size > 32 * 1024 * 1024 || sha(readFileSync(file)) !== archiveHash) throw new Error('Approved ZIP hash mismatch')
  const read = (entry: string) => execFileSync('/usr/bin/unzip', ['-p', file, entry], { maxBuffer: 12 * 1024 * 1024, timeout: 15000 })
  return approvedPack.icons.map(icon => {
    const bytes = read(`runtime/${icon.filename}`)
    const provenance = verifyPreparedIcon(icon, read(`originals/${icon.source_filename}`), bytes)
    return { icon, bytes, provenance, metadata: metadataForIcon(icon) }
  })
}

const preparedSchema = z.object({ iconId: z.uuid(), versionId: z.uuid(), state: z.enum(['validated', 'approved', 'published', 'retired', 'revoked']),
  packageHash: z.string().regex(/^[a-f0-9]{64}$/), originalPath: z.string(), cropPath: z.string(), runtimePath: z.string() })
type ImportInput = { archive: string; url: string; publicKey: string; serviceKey: string; email: string; password: string }

export async function importApprovedV1Pack(input: ImportInput) {
  assertLocalIconTarget(input.url)
  // Validate ALL nine packages before authenticating or mutating anything.
  const packages = readApprovedPack(input.archive)
  const safeFetch: typeof fetch = (url, init) => {
    if (new URL(url instanceof Request ? url.url : String(url)).origin !== input.url) throw new Error('Unexpected request origin')
    return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) })
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch } }
  const admin = createClient(input.url, input.publicKey, options)
  const storage = createClient(input.url, input.serviceKey, options)
  if ((await admin.auth.signInWithPassword({ email: input.email, password: input.password })).error) throw new Error('Local curator authentication failed')
  const results = []
  for (const { icon, bytes, provenance, metadata } of packages) {
    const slug = icon.filename.slice(0, -4), name = names[slug]
    if (!name) throw new Error('Unknown approved icon name')
    const prepared = await admin.rpc('prepare_map_icon_version', {
      p_request_id: iconRequestId(icon), p_slug: slug, p_name: name, p_metadata: metadata, p_provenance: provenance,
    })
    if (prepared.error) throw new Error(`Prepare ${slug}: ${prepared.error.message}`)
    const v = preparedSchema.parse(prepared.data), base = `icons/${v.iconId}/${v.versionId}`
    if (v.originalPath !== `${base}/original.png` || v.cropPath !== `${base}/crop.png` || v.runtimePath !== `${base}/${icon.sha256}.png`)
      throw new Error('Noncanonical Storage key returned')
    if (v.state === 'retired' || v.state === 'revoked') throw new Error(`${slug} is no longer publishable`)
    const ensure = async (bucket: string, path: string, mayUpload: boolean) => {
      let existing = await storage.storage.from(bucket).download(path)
      if (existing.error) {
        if (!mayUpload || !['Object not found', 'The resource was not found'].includes(existing.error.message)) throw new Error(`Cannot read ${slug} required asset`)
        const upload = await storage.storage.from(bucket).upload(path, bytes, {
          contentType: 'image/png', cacheControl: bucket === 'map-icon-published' ? '31536000' : '0', upsert: false,
        })
        existing = await storage.storage.from(bucket).download(path)
        if (existing.error) throw new Error(`Upload/readback ${slug}: ${upload.error?.message ?? existing.error.message}`)
      }
      if (!existing.data || sha(new Uint8Array(await existing.data.arrayBuffer())) !== icon.sha256) throw new Error(`Stored bytes differ: ${slug}`)
    }
    const transition = async (action: string) => {
      const result = await admin.rpc('transition_map_icon_version', { p_version_id: v.versionId, p_package_hash: v.packageHash, p_action: action,
        p_reason: `V1 prepared source verified against approved ZIP ${archiveHash}; identity crop and decoded RGBA verified` })
      if (result.error) throw new Error(`Transition ${slug}: ${result.error.message}`)
    }
    await ensure('map-icon-originals', v.originalPath, v.state === 'validated')
    await ensure('map-icon-originals', v.cropPath, v.state === 'validated')
    if (v.state === 'validated') await transition('approved')
    await ensure('map-icon-published', v.runtimePath, v.state !== 'published')
    const response = await safeFetch(`${input.url}/storage/v1/object/public/map-icon-published/${v.runtimePath}`, { headers: { Origin: 'http://127.0.0.1:3107' } })
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/png'
      || response.headers.get('access-control-allow-origin') !== '*' || !response.headers.get('cache-control')?.includes('max-age=31536000')
      || sha(new Uint8Array(await response.arrayBuffer())) !== icon.sha256) throw new Error(`Public delivery verification failed: ${slug}`)
    if (v.state !== 'published') await transition('published')
    results.push({ slug, name, versionId: v.versionId, runtimePath: v.runtimePath, state: 'published' })
  }
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value }
  try {
    if (process.argv[2] === 'verify') console.log(JSON.stringify(readApprovedPack(required('ICON_PACK_ZIP')).map(p => ({ filename: p.icon.filename, metadata: p.metadata, provenance: p.provenance })), null, 2))
    else if (process.argv[2] === 'import') console.log(JSON.stringify(await importApprovedV1Pack({ archive: required('ICON_PACK_ZIP'), url: required('ICON_API_URL'),
      publicKey: required('ICON_PUBLIC_KEY'), serviceKey: required('ICON_SERVICE_KEY'), email: required('ICON_ADMIN_EMAIL'), password: required('ICON_ADMIN_PASSWORD') }), null, 2))
    else throw new Error('Choose verify or import')
  } catch (error) { console.error(error instanceof Error ? error.message : 'Icon pack import failed'); process.exitCode = 1 }
}
