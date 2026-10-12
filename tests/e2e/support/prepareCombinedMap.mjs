import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { importApprovedFlag } from '../../../scripts/map-icons/import-flag.ts'
import { approvedMetadata, approvedHash, validateApprovedAsset } from './publishGrandOpeningProof.mjs'
import { combinedMapEnvironment, docker, project } from './combinedMapEnvironment.mjs'

export async function prepareCombinedMap() {
  const local = await combinedMapEnvironment()
  const safeFetch = (url, init) => {
    assert.equal(new URL(url instanceof Request ? url.url : String(url)).origin, local.API_URL)
    return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) })
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch } }
  const storage = createClient(local.API_URL, local.SERVICE_KEY, options)
  const email = `combined-curator-${randomUUID()}@example.test`, password = `Proof-${randomUUID()}!`
  const user = await storage.auth.admin.createUser({ email, password, email_confirm: true })
  assert.ifError(user.error); const id = user.data.user.id
  assert.match(id, /^[0-9a-f-]{36}$/)
  docker(['exec', `supabase_db_${project}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-c',
    `insert into private.staff_roles(user_id,role,active,granted_by) values('${id}','admin',true,'${id}');`])
  assert(process.env.APPROVED_FLAG_ORIGINAL && process.env.APPROVED_FLAG_CROP)
  const flag = await importApprovedFlag({ url: local.API_URL, publicKey: local.ANON_KEY, serviceKey: local.SERVICE_KEY,
    email, password, originalFile: process.env.APPROVED_FLAG_ORIGINAL, runtimeFile: process.env.APPROVED_FLAG_CROP })
  const asset = validateApprovedAsset()
  const curator = createClient(local.API_URL, local.ANON_KEY, options)
  assert.ifError((await curator.auth.signInWithPassword({ email, password })).error)
  const prepared = await curator.rpc('prepare_map_icon_version', { p_request_id: '25000000-0000-4000-8000-000000000501',
    p_slug: 'grand-opening', p_name: 'Grand Opening', p_metadata: approvedMetadata, p_provenance: asset.provenance })
  assert.ifError(prepared.error); const grand = prepared.data
  assert(['validated', 'approved', 'published'].includes(grand.state))
  async function object(bucket, path) {
    let existing = await storage.storage.from(bucket).download(path)
    if (existing.error) {
      assert(['Object not found', 'The resource was not found'].includes(existing.error.message))
      assert.notEqual(grand.state, 'published', 'Do not repair missing published assets')
      assert.ifError((await storage.storage.from(bucket).upload(path, asset.bytes, { contentType: 'image/png', cacheControl: bucket === 'map-icon-published' ? '31536000' : '0', upsert: false })).error)
      existing = await storage.storage.from(bucket).download(path)
    }
    assert.ifError(existing.error)
    assert(Buffer.from(await existing.data.arrayBuffer()).equals(asset.bytes))
  }
  async function transition(action) {
    assert.ifError((await curator.rpc('transition_map_icon_version', { p_version_id: grand.versionId, p_package_hash: grand.packageHash,
      p_action: action, p_reason: 'Combined local proof: exact approved PNG and metadata verified' })).error)
  }
  await object('map-icon-originals', grand.originalPath); await object('map-icon-originals', grand.cropPath)
  if (grand.state === 'validated') await transition('approved')
  await object('map-icon-published', grand.runtimePath)
  if (grand.state !== 'published') await transition('published')
  assert(grand.runtimePath.endsWith('/' + approvedHash + '.png'))
  // Explicit local fixture enablement, after environment identity and disabled-default proof.
  docker(['exec', `supabase_db_${project}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-c',
    "update private.map_icon_settings set rendering_enabled=true,selection_enabled=true where singleton;"])
  return { flag: flag.versionId, grand: grand.versionId }
}
