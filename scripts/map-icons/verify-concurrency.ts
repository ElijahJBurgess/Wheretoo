/** Explicit isolated-DB integration proof. Creates uniquely named unpublished
 * fixtures and leaves them for inspection; never resets a stack or uses hosted DB. */
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const db = 'postgresql://postgres:postgres@127.0.0.1:56322/postgres?sslmode=disable'
const psql = process.env.ICON_PSQL ?? '/usr/local/opt/libpq/bin/psql'
const sql = (query: string) => execFileSync(psql, [db, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8', timeout: 10000 }).trim()
const admin = sql("select user_id from private.staff_roles where role='admin' and active order by created_at limit 1")
if (!/^[a-f0-9-]{36}$/.test(admin)) throw new Error('Isolated admin fixture required')
const claim = `select set_config('request.jwt.claim.sub','${admin}',false);`
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

for (const action of ['approved', 'published']) {
  const request = randomUUID()
  const result = sql(`${claim}
    select public.prepare_map_icon_version('${request}','race-${request}','Concurrency proof',metadata,provenance)
    from private.map_icon_versions where state='published' limit 1;`)
  const v = JSON.parse(result.split('\n').at(-1)!) as { versionId: string; packageHash: string; originalPath: string; cropPath: string; runtimePath: string }
  const transition = `select public.transition_map_icon_version('${v.versionId}','${v.packageHash}','${action}','Concurrency proof');`
  sql(`insert into storage.objects(bucket_id,name,metadata)
    select 'map-icon-originals', original_path,jsonb_build_object('mimetype','image/png','size',(provenance->>'originalBytes')::integer)
    from private.map_icon_versions where id='${v.versionId}';
    insert into storage.objects(bucket_id,name,metadata)
    select 'map-icon-originals',crop_path,jsonb_build_object('mimetype','image/png','size',byte_size)
    from private.map_icon_versions where id='${v.versionId}';`)
  if (action === 'published') sql(`${claim}
    select public.transition_map_icon_version('${v.versionId}','${v.packageHash}','approved','Concurrency setup');
    insert into storage.objects(bucket_id,name,metadata)
    select 'map-icon-published',runtime_path,jsonb_build_object('mimetype','image/png','size',byte_size)
    from private.map_icon_versions where id='${v.versionId}';`)
  const writer = spawn(psql, [db, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''; let errors = ''
  writer.stdout.on('data', b => { output += String(b) })
  writer.stderr.on('data', b => { errors += String(b) })
  const writerDone = new Promise<void>((resolve, reject) => writer.once('close', code => code === 0 ? resolve() : reject(new Error(errors))))
  // Both paths belong solely to the new synthetic fixture; no runtime blob exists.
  const bucket = action === 'approved' ? 'map-icon-originals' : 'map-icon-published'
  const path = action === 'approved' ? v.originalPath : v.runtimePath
  writer.stdin.write(`begin; update storage.objects set metadata=jsonb_set(metadata,'{size}','0') where bucket_id='${bucket}' and name='${path}'; select 'WRITER_READY';\n`)
  const until = Date.now() + 5000
  while (!output.includes('WRITER_READY') && Date.now() < until && !errors) await sleep(25)
  if (!output.includes('WRITER_READY')) { writer.stdin.end('rollback;\n'); await writerDone; throw new Error('Writer barrier failed') }
  const reader = spawn(psql, [db + `&application_name=icon-race-${request}`, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', claim + transition], { stdio: ['ignore', 'pipe', 'pipe'] })
  let readerError = ''; let readerExited = false
  reader.stderr.on('data', b => { readerError += String(b) })
  const readerDone = new Promise<number | null>(resolve => reader.once('close', code => { readerExited = true; resolve(code) }))
  let blocked = false
  const deadline = Date.now() + 5000
  while (!readerExited && Date.now() < deadline) {
    blocked = sql(`select exists(select 1 from pg_stat_activity where application_name='icon-race-${request}' and cardinality(pg_blocking_pids(pid))>0)`) === 't'
    if (blocked) break
    await sleep(25)
  }
  writer.stdin.end('commit;\n')
  await writerDone
  const code = await readerDone
  if (!blocked || code === 0 || !readerError.includes(action === 'approved' ? 'ICON_PRIVATE_ASSETS_MISSING' : 'ICON_RUNTIME_ASSET_MISSING'))
    throw new Error(`${action}: concurrent removal was not safely serialized (blocked=${blocked}, code=${code})`)
  console.log(`PASS ${action}: waits for Storage mutation, then rejects missing asset`)
}
