import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { iconMetadataSchema } from '../../src/features/map-icons/icon.schemas.ts'

const runtimeHash = '9dcb326dc3d1fc2a79ad41ce5834173acf8682e71b6dac67edc244cab2d50e7d'
const originalHash = '0cfd671af58597bb5d37b4ed8b8d70bafef476fee16b796d26f957acd2840a86'
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
export const approvedFlagMetadata = iconMetadataSchema.parse({
  schemaVersion: 1, widthPx: 600, heightPx: 922, pixelRatio: 3, contactPx: [87, 922],
  anchor: 'bottom', selectedScale: 1,
  desktop: { minZoom: 14.5, maxZoom: 24, stops: [[14.6, .18], [14.8, .19], [16.25, .22]] },
  mobile: { minZoom: 14.5, maxZoom: 24, stops: [[14.6, .18], [14.8, .19], [16.25, .22]] },
  hit: { kind: 'legacy-css-circle', radius: 38, translation: [17, -34], minTargetDiameter: 44 },
  alignment: { pitch: 'viewport', rotation: 'viewport' }, collisionMode: 'always-visible', sdf: false,
})

export function assertLocalIconTarget(url: string): void {
  if (!['http://127.0.0.1:56321', 'http://127.0.0.1:64321'].includes(url)) throw new Error('Only a dedicated isolated Icon Library loopback API is permitted')
}

/** This is intentionally an importer for ONE approved package, not an arbitrary
 * image ingestion endpoint. Exact byte hashes are checked before decoding. */
export function verifyFlagBuffers(original: Buffer, runtime: Buffer) {
  if (hash(original) !== originalHash || hash(runtime) !== runtimeHash || runtime.length !== 409155)
    throw new Error('Approved flag bytes do not match; no asset was uploaded')
  if (original.readUInt32BE(16) !== 1254 || original.readUInt32BE(20) !== 1254 ||
    runtime.readUInt32BE(16) !== 600 || runtime.readUInt32BE(20) !== 922)
    throw new Error('Approved dimensions do not match')
  const decode = (input: Buffer, crop: string[]) => execFileSync('magick', [
    '-limit', 'memory', '128MiB', '-limit', 'map', '0', '-limit', 'disk', '0',
    'png:-', ...crop, '-depth', '8', 'rgba:-',
  ], { input, maxBuffer: 8 * 1024 * 1024, timeout: 15000 })
  const region = decode(original, ['-crop', '600x922+394+152', '+repage'])
  const pixels = decode(runtime, [])
  if (pixels.length !== 600 * 922 * 4 || !pixels.equals(region)) throw new Error('Crop pixels differ from original')
  return { originalSha256: originalHash, pngSha256: runtimeHash, rgbaSha256: hash(pixels),
    originalBytes: original.length, runtimeBytes: runtime.length, originalWidth: 1254, originalHeight: 1254,
    crop: { x: 394, y: 152, width: 600, height: 922 } }
}

const preparedSchema = z.strictObject({ iconId: z.uuid(), versionId: z.uuid(),
  state: z.enum(['validated', 'approved', 'published', 'retired', 'revoked']),
  packageHash: z.string().regex(/^[a-f0-9]{64}$/), originalPath: z.string(), cropPath: z.string(), runtimePath: z.string() })

export async function importApprovedFlag(input: {
  url: string; serviceKey: string; publicKey: string; email: string; password: string; originalFile: string;
  runtimeFile?: string;
}) {
  assertLocalIconTarget(input.url)
  const original = readFileSync(input.originalFile)
  const runtime = readFileSync(input.runtimeFile ?? resolve('public/map/markers/wheretoo-event-flag.png'))
  const provenance = verifyFlagBuffers(original, runtime)
  const safeFetch: typeof fetch = (url, init) => {
    const target = new URL(url instanceof Request ? url.url : String(url))
    if (target.origin !== input.url) throw new Error('Unexpected request origin')
    return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) })
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch } }
  const admin = createClient(input.url, input.publicKey, options)
  const storage = createClient(input.url, input.serviceKey, options)
  const login = await admin.auth.signInWithPassword({ email: input.email, password: input.password })
  if (login.error) throw new Error('Local curator authentication failed')
  const prepared = await admin.rpc('prepare_map_icon_version', {
    p_request_id: '24000000-0000-4000-8000-000000000100', p_slug: 'wheretoo-flag', p_name: 'Wheretoo Flag',
    p_metadata: approvedFlagMetadata, p_provenance: provenance,
  })
  if (prepared.error) throw new Error(`Prepare failed: ${prepared.error.message}`)
  const v = preparedSchema.parse(prepared.data)
  const base = `icons/${v.iconId}/${v.versionId}`
  if (v.originalPath !== `${base}/original.png` || v.cropPath !== `${base}/crop.png` || v.runtimePath !== `${base}/${runtimeHash}.png`)
    throw new Error('Noncanonical Storage key returned')
  if (v.state === 'retired' || v.state === 'revoked') throw new Error('This approved version is no longer publishable')

  async function ensureObject(bucket: string, path: string, bytes: Buffer, mayUpload: boolean) {
    const get = () => storage.storage.from(bucket).download(path)
    let existing = await get()
    if (existing.error) {
      if (!mayUpload || !['Object not found', 'The resource was not found'].includes(existing.error.message))
        throw new Error(`Cannot read required ${bucket} asset: ${existing.error.message}`)
      const uploaded = await storage.storage.from(bucket).upload(path, bytes, {
        contentType: 'image/png', cacheControl: bucket === 'map-icon-published' ? '31536000' : '0', upsert: false,
      })
      // A concurrent identical attempt may have won. Never overwrite; verify it.
      existing = await get()
      if (existing.error) throw new Error(`Upload/readback failed: ${uploaded.error?.message ?? existing.error.message}`)
    }
    if (!existing.data || hash(new Uint8Array(await existing.data.arrayBuffer())) !== hash(bytes))
      throw new Error(`Stored bytes differ for ${bucket}; refusing overwrite`)
  }
  const transition = async (action: string) => {
    const result = await admin.rpc('transition_map_icon_version', { p_version_id: v.versionId,
      p_package_hash: v.packageHash, p_action: action, p_reason: 'Approved flag: exact bytes, crop RGBA and metadata verified by local curator importer' })
    if (result.error) throw new Error(`${action} failed: ${result.error.message}`)
  }
  await ensureObject('map-icon-originals', v.originalPath, original, v.state === 'validated')
  await ensureObject('map-icon-originals', v.cropPath, runtime, v.state === 'validated')
  if (v.state === 'validated') await transition('approved')
  await ensureObject('map-icon-published', v.runtimePath, runtime, v.state !== 'published')
  const publicResponse = await safeFetch(`${input.url}/storage/v1/object/public/map-icon-published/${v.runtimePath}`, {
    headers: { Origin: 'http://127.0.0.1:3010' },
  })
  if (!publicResponse.ok || !publicResponse.headers.get('content-type')?.startsWith('image/png') ||
    publicResponse.headers.get('access-control-allow-origin') !== '*' ||
    !publicResponse.headers.get('cache-control')?.includes('max-age=31536000') ||
    hash(new Uint8Array(await publicResponse.arrayBuffer())) !== runtimeHash)
    throw new Error('Public delivery byte/type/CORS/cache verification failed')
  if (v.state !== 'published') await transition('published')
  return { iconId: v.iconId, versionId: v.versionId, packageHash: v.packageHash,
    runtimePath: v.runtimePath, pngSha256: runtimeHash, rgbaSha256: provenance.rgbaSha256, state: 'published' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value }
  importApprovedFlag({ url: required('ICON_API_URL'), serviceKey: required('ICON_SERVICE_KEY'), publicKey: required('ICON_PUBLIC_KEY'),
    email: required('ICON_ADMIN_EMAIL'), password: required('ICON_ADMIN_PASSWORD'), originalFile: required('ICON_ORIGINAL_FILE') })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error instanceof Error ? error.message : 'Import failed'); process.exitCode = 1 })
}
