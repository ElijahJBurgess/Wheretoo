import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { iconMetadataSchema } from '../../../src/features/map-icons/icon.schemas.ts'
import { iconLibraryEnvironment } from './iconLibraryEnvironment.mjs'
import { sha256 } from './phase5bIdentity.mjs'

export const secondIconName = 'Grand Opening'
export const approvedHash = '8b712a172ff47c656b7edf64c813c6414a824d9731d7890e991d2838ee2b3ea9'
export const approvedMetadata = iconMetadataSchema.parse({
  schemaVersion: 1, widthPx: 512, heightPx: 768, pixelRatio: 3, contactPx: [255, 711], anchor: 'bottom', selectedScale: 1,
  desktop: { minZoom: 14.5, maxZoom: 24, stops: [[14.6, .30], [14.8, .32], [16.25, .36]] },
  mobile: { minZoom: 14.5, maxZoom: 24, stops: [[14.6, .30], [14.8, .32], [16.25, .36]] },
  hit: { kind: 'legacy-css-circle', radius: 40, translation: [0, -38], minTargetDiameter: 44 },
  alignment: { pitch: 'viewport', rotation: 'viewport' }, collisionMode: 'always-visible', sdf: false,
})
export function validateApprovedAsset(path = process.env.APPROVED_GRAND_OPENING_PNG) {
  assert(path, 'Provide APPROVED_GRAND_OPENING_PNG for the exact approved package')
  const bytes = readFileSync(path)
  assert.equal(sha256(bytes), approvedHash); assert.equal(bytes.length, 490445)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(bytes.readUInt32BE(16), 512); assert.equal(bytes.readUInt32BE(20), 768)
  const rgba = execFileSync('magick', ['-limit', 'memory', '128MiB', '-limit', 'map', '0', '-limit', 'disk', '0', 'png:-', '-depth', '8', 'rgba:-'], { input: bytes, maxBuffer: 3000000, timeout: 15000 })
  assert.equal(rgba.length, 512 * 768 * 4)
  let transparent = 0, left = 512, top = 768, right = -1, bottom = -1
  for (let y = 0; y < 768; y++) for (let x = 0; x < 512; x++) {
    if (!rgba[(y * 512 + x) * 4 + 3]) transparent++
    else { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y) }
  }
  return { bytes, alphaBounds: { left, top, right, bottom, transparent }, provenance: {
    originalSha256: approvedHash, pngSha256: approvedHash, rgbaSha256: sha256(rgba), originalBytes: bytes.length, runtimeBytes: bytes.length,
    originalWidth: 512, originalHeight: 768, crop: { x: 0, y: 0, width: 512, height: 768 },
  } }
}

// Test/operator-only, exact approved package. No frontend importer or upload UI.
export async function publishGrandOpening() {
  const asset = validateApprovedAsset(), local = await iconLibraryEnvironment()
  const kong = execFileSync('docker', ['exec', 'supabase_kong_wheretoo-icon-library', 'cat', '/home/kong/kong.yml'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
  const serviceKey = kong.match(/eyJ[A-Za-z0-9_.-]+/g)?.find(token => {
    try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role === 'service_role' } catch { return false }
  })
  assert(serviceKey, 'Local Storage credential unavailable')
  const safeFetch = (url, init) => {
    assert.equal(new URL(url instanceof Request ? url.url : String(url)).origin, local.API_URL)
    return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) })
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch } }
  const storage = createClient(local.API_URL, serviceKey, options)
  // Separately provisioned fixture identity, same local-only setup as foundation
  // verification. No existing staff account/role or production setting changes.
  const email = `phase5b-curator-${randomUUID()}@example.test`, password = `Proof-${randomUUID()}!`
  const created = await storage.auth.admin.createUser({ email, password, email_confirm: true })
  assert.ifError(created.error); const id = created.data.user.id
  assert.match(id, /^[0-9a-f-]{36}$/)
  execFileSync('docker', ['exec', 'supabase_db_wheretoo-icon-library', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-c',
    `insert into private.staff_roles(user_id,role,active,granted_by) values('${id}','admin',true,'${id}')`], { timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
  const curator = createClient(local.API_URL, local.ANON_KEY, options)
  assert.ifError((await curator.auth.signInWithPassword({ email, password })).error)
  const prepared = await curator.rpc('prepare_map_icon_version', { p_request_id: '25000000-0000-4000-8000-000000000501',
    p_slug: 'grand-opening', p_name: secondIconName, p_metadata: approvedMetadata, p_provenance: asset.provenance })
  assert.ifError(prepared.error); const v = prepared.data
  assert(['validated', 'approved', 'published'].includes(v.state))
  assert.equal(v.runtimePath, `icons/${v.iconId}/${v.versionId}/${approvedHash}.png`)
  async function object(bucket, path) {
    let existing = await storage.storage.from(bucket).download(path)
    if (existing.error) {
      assert(['Object not found', 'The resource was not found'].includes(existing.error.message))
      assert.notEqual(v.state, 'published', 'Published asset missing; never repair silently')
      const upload = await storage.storage.from(bucket).upload(path, asset.bytes, { contentType: 'image/png', cacheControl: bucket === 'map-icon-published' ? '31536000' : '0', upsert: false })
      assert.ifError(upload.error); existing = await storage.storage.from(bucket).download(path)
    }
    assert.ifError(existing.error); assert.equal(sha256(new Uint8Array(await existing.data.arrayBuffer())), approvedHash)
  }
  const transition = async action => {
    const r = await curator.rpc('transition_map_icon_version', { p_version_id: v.versionId, p_package_hash: v.packageHash,
      p_action: action, p_reason: 'Phase 5B: user-approved Grand Opening PNG, exact original bytes and decoded RGBA verified; schema-1 metadata' })
    assert.ifError(r.error)
  }
  await object('map-icon-originals', v.originalPath); await object('map-icon-originals', v.cropPath)
  if (v.state === 'validated') await transition('approved')
  await object('map-icon-published', v.runtimePath)
  const response = await safeFetch(`${local.API_URL}/storage/v1/object/public/map-icon-published/${v.runtimePath}`, { headers: { Origin: 'http://127.0.0.1:3015' } })
  assert(response.ok); assert(response.headers.get('content-type')?.startsWith('image/png'))
  assert.equal(response.headers.get('access-control-allow-origin'), '*'); assert(response.headers.get('cache-control')?.includes('max-age=31536000'))
  assert.equal(sha256(new Uint8Array(await response.arrayBuffer())), approvedHash)
  if (v.state !== 'published') await transition('published')
  return { ...v, state: 'published', name: secondIconName, pngSha256: approvedHash, metadata: approvedMetadata, provenance: asset.provenance, alphaBounds: asset.alphaBounds, publishedProofAt: new Date().toISOString() }
}
