#!/usr/bin/env node
/* Separate local negative control for a genuinely pre-history eligible event.
 * The fixture is cloned under fixed, enumerated IDs and removed in finally. */
process.umask(0o077)
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
require('tsx/cjs')
const { chromium, expect: baseExpect } = require('@playwright/test')
const expect = baseExpect.configure({ timeout: 40_000 })
const { dbJson, origin, providerBoundaries, quote, sql } = require('./support/spec14Harness.ts')
const { verifiedIdentity, verificationSourceHashes } = require('./spec14-visual.cjs')

const root = path.resolve(__dirname, '../..')
const state = path.join(root, '.superpowers/spec14')
const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const fixtureIds = Object.freeze({
  event: 'f1460000-0000-4000-8000-000000000001',
  acceptance: 'f1460000-0000-4000-8000-000000000002',
  action: 'f1460000-0000-4000-8000-000000000003',
})

function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error('Invalid UUID')
  return value
}
function inputs(value) {
  return { sourceEvent: uuid(value.sourceEvent), organizer: uuid(value.organizer), instance: uuid(value.instance) }
}
function identityGuard(instance) {
  return `do $spec14_guard$ begin
 if (select instance_id from spec14_control.identity) is distinct from '${instance}'
    or current_setting('cron.launch_active_jobs') is distinct from 'off' then
  raise exception 'LEGACY_FIXTURE_TASK_IDENTITY_MISMATCH';
 end if;
end $spec14_guard$;`
}

function setupSql(value) {
  const { sourceEvent, organizer, instance } = inputs(value)
  const id = fixtureIds
  return `begin;
${identityGuard(instance)}
do $legacy_guard$ begin
 if exists(select 1 from public.events where id='${id.event}')
    or exists(select 1 from private.event_policy_acceptances where id='${id.acceptance}')
    or exists(select 1 from private.event_moderation_actions where id='${id.action}') then
  raise exception 'LEGACY_FIXTURE_ID_ALREADY_PRESENT';
 end if;
 if not exists(select 1 from public.events e
   join private.event_risk_disclosures d on d.event_id=e.id
   join private.event_moderation_actions a on a.id=e.publicly_authorized_action_id and a.event_id=e.id
   join private.event_policy_acceptances p on p.id=a.policy_acceptance_id and p.event_id=e.id and p.organizer_id=e.organizer_id
   join private.event_public_eligibility_intervals i on i.event_id=e.id and i.public_eligibility_version=e.public_eligibility_version
     and i.eligibility_state='eligible' and i.ended_at is null
   where e.id='${sourceEvent}' and e.organizer_id='${organizer}' and e.status='published'
     and private.event_is_publicly_eligible(e.id,clock_timestamp())) then
  raise exception 'LEGACY_FIXTURE_SOURCE_NOT_CURRENT_ELIGIBLE';
 end if;
end $legacy_guard$;
set local session_replication_role=replica;
insert into public.events
select (jsonb_populate_record(null::public.events,to_jsonb(e)||jsonb_build_object(
 'id','${id.event}','publicly_authorized_action_id','${id.action}'))).* from public.events e where e.id='${sourceEvent}';
insert into private.event_risk_disclosures
select (jsonb_populate_record(null::private.event_risk_disclosures,to_jsonb(d)||jsonb_build_object(
 'event_id','${id.event}'))).* from private.event_risk_disclosures d where d.event_id='${sourceEvent}';
insert into private.event_policy_acceptances
select (jsonb_populate_record(null::private.event_policy_acceptances,to_jsonb(p)||jsonb_build_object(
 'id','${id.acceptance}','event_id','${id.event}'))).* from private.event_policy_acceptances p
join private.event_moderation_actions a on a.policy_acceptance_id=p.id
join public.events e on e.publicly_authorized_action_id=a.id where e.id='${sourceEvent}';
insert into private.event_moderation_actions
select (jsonb_populate_record(null::private.event_moderation_actions,to_jsonb(a)||jsonb_build_object(
 'id','${id.action}','event_id','${id.event}','policy_acceptance_id','${id.acceptance}',
 'evaluation_id',null,'review_request_id',null,'policy_legacy_exemption_id',null))).*
from private.event_moderation_actions a join public.events e on e.publicly_authorized_action_id=a.id where e.id='${sourceEvent}';
insert into private.event_public_eligibility_intervals
select (jsonb_populate_record(null::private.event_public_eligibility_intervals,to_jsonb(i)||jsonb_build_object(
 'event_id','${id.event}','started_action_id','${id.action}','ended_action_id',null))).*
from private.event_public_eligibility_intervals i join public.events e on e.id=i.event_id
where e.id='${sourceEvent}' and i.public_eligibility_version=e.public_eligibility_version and i.ended_at is null;
set local session_replication_role=origin;
do $legacy_validate$ begin
 if private.event_change_facts('${id.event}') is distinct from private.event_change_facts('${sourceEvent}')
    or not private.event_is_publicly_eligible('${id.event}',clock_timestamp())
    or exists(select 1 from private.event_change_state where event_id='${id.event}')
    or exists(select 1 from private.event_change_snapshots where event_id='${id.event}')
    or exists(select 1 from public.orders where event_id='${id.event}')
    or exists(select 1 from public.free_registrations where event_id='${id.event}')
    or exists(select 1 from public.tickets where event_id='${id.event}')
    or exists(select 1 from private.event_notices where event_id='${id.event}') then
  raise exception 'LEGACY_FIXTURE_SETUP_INVALID';
 end if;
end $legacy_validate$;
commit;
`
}

function cleanupSql(value) {
  const { sourceEvent, organizer, instance } = inputs(value)
  const id = fixtureIds
  return `begin;
${identityGuard(instance)}
do $legacy_cleanup_guard$ begin
 if not exists(select 1 from public.events e where e.id='${id.event}' and e.organizer_id='${organizer}'
   and e.publicly_authorized_action_id='${id.action}' and private.event_change_facts(e.id) is not distinct from private.event_change_facts('${sourceEvent}'))
    or (select count(*) from private.event_policy_acceptances where id='${id.acceptance}' and event_id='${id.event}')<>1
    or (select count(*) from private.event_moderation_actions where id='${id.action}' and event_id='${id.event}' and policy_acceptance_id='${id.acceptance}')<>1
    or (select count(*) from private.event_public_eligibility_intervals where event_id='${id.event}')<>1
    or (select count(*) from private.event_change_state where event_id='${id.event}')>1
    or (select count(*) from private.event_change_snapshots where event_id='${id.event}')>1
    or exists(select 1 from private.event_change_state s where s.event_id='${id.event}' and
      (s.previous_saved_snapshot_id is not null or s.previous_public_snapshot_id is not null or
       s.current_saved_snapshot_id is distinct from s.current_public_snapshot_id))
    or exists(select 1 from public.ticket_tiers where event_id='${id.event}')
    or exists(select 1 from public.orders where event_id='${id.event}')
    or exists(select 1 from public.free_registrations where event_id='${id.event}')
    or exists(select 1 from public.tickets where event_id='${id.event}')
    or exists(select 1 from private.event_notices where event_id='${id.event}')
    or exists(select 1 from private.event_notice_sources where event_id='${id.event}')
    or exists(select 1 from private.event_moderation_evaluations where event_id='${id.event}')
    or exists(select 1 from private.event_reports where event_id='${id.event}')
    or exists(select 1 from private.event_policy_legacy_exemptions where event_id='${id.event}')
    or exists(select 1 from private.event_legacy_history_resolutions where event_id='${id.event}') then
  raise exception 'LEGACY_FIXTURE_UNEXPECTED_DEPENDENCY';
 end if;
end $legacy_cleanup_guard$;
set local session_replication_role=replica;
delete from private.event_change_state where event_id='${id.event}';
delete from private.event_change_snapshots where event_id='${id.event}';
delete from private.event_public_eligibility_intervals where event_id='${id.event}';
delete from private.event_moderation_actions where id='${id.action}' and event_id='${id.event}';
delete from private.event_policy_acceptances where id='${id.acceptance}' and event_id='${id.event}';
delete from private.event_risk_disclosures where event_id='${id.event}';
delete from public.events where id='${id.event}' and organizer_id='${organizer}';
set local session_replication_role=origin;
do $legacy_cleanup_verify$ begin
 if exists(select 1 from public.events where id='${id.event}')
    or exists(select 1 from private.event_change_state where event_id='${id.event}')
    or exists(select 1 from private.event_change_snapshots where event_id='${id.event}')
    or exists(select 1 from private.event_public_eligibility_intervals where event_id='${id.event}')
    or exists(select 1 from private.event_moderation_actions where id='${id.action}')
    or exists(select 1 from private.event_policy_acceptances where id='${id.acceptance}') then
  raise exception 'LEGACY_FIXTURE_RESIDUE';
 end if;
end $legacy_cleanup_verify$;
commit;
`
}

const readRpcs = new Set(['get_my_staff_role', 'get_owned_event_change_context', 'get_owned_event_notice_status'])
function businessWriter(request) {
  const url = new URL(request.url())
  if (url.hostname !== '127.0.0.1' || !['3040', '55647'].includes(url.port)) return null
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const name = url.pathname.slice('/rest/v1/rpc/'.length)
    return readRpcs.has(name) ? null : `rpc:${name || 'unknown'}`
  }
  if (url.pathname.startsWith('/functions/v1/')) return `function:${url.pathname.slice('/functions/v1/'.length) || 'unknown'}`
  if (url.pathname.startsWith('/rest/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return `rest:${url.pathname.slice('/rest/v1/'.length).split('/')[0] || 'unknown'}`
  return null
}

function validateObservedState(row) {
  if (row.eventCount !== 1 || row.stateCount !== 1 || row.snapshotCount !== 1 || !row.currentSaved ||
      row.previousSaved !== null || row.currentPublic !== row.currentSaved || row.previousPublic !== null ||
      row.currentlyEligible !== true || row.sourceFactsPreserved !== true || row.orders || row.registrations || row.tickets || row.notices) {
    throw new Error('Legacy fixture has unexpected history or dependent state')
  }
  return { snapshot: row.currentSaved }
}

function sourceEventFromScenario(scenario) {
  const selected = scenario?.events?.free
  if (selected?.admission !== 'free' || !selected.id) throw new Error('Original free event unavailable')
  return uuid(selected.id)
}

function fixtureState(sourceEvent) {
  return dbJson(`select jsonb_build_object(
   'eventCount',(select count(*) from public.events where id=${quote(fixtureIds.event)}),
   'stateCount',(select count(*) from private.event_change_state where event_id=${quote(fixtureIds.event)}),
   'snapshotCount',(select count(*) from private.event_change_snapshots where event_id=${quote(fixtureIds.event)}),
   'currentSaved',(select current_saved_snapshot_id from private.event_change_state where event_id=${quote(fixtureIds.event)}),
   'previousSaved',(select previous_saved_snapshot_id from private.event_change_state where event_id=${quote(fixtureIds.event)}),
   'currentPublic',(select current_public_snapshot_id from private.event_change_state where event_id=${quote(fixtureIds.event)}),
   'previousPublic',(select previous_public_snapshot_id from private.event_change_state where event_id=${quote(fixtureIds.event)}),
   'currentlyEligible',private.event_is_publicly_eligible(${quote(fixtureIds.event)},clock_timestamp()),
   'sourceFactsPreserved',private.event_change_facts(${quote(fixtureIds.event)}) is not distinct from private.event_change_facts(${quote(sourceEvent)}),
   'orders',(select count(*) from public.orders where event_id=${quote(fixtureIds.event)}),
   'registrations',(select count(*) from public.free_registrations where event_id=${quote(fixtureIds.event)}),
   'tickets',(select count(*) from public.tickets where event_id=${quote(fixtureIds.event)}),
   'notices',(select count(*) from private.event_notices where event_id=${quote(fixtureIds.event)}));`)
}

async function main() {
  const runner = 'tests/e2e/spec14-j06-legacy-history.cjs'
  const sourceHashes = verificationSourceHashes(runner)
  const identity = await verifiedIdentity()
  const environment = JSON.parse(fs.readFileSync(path.join(state, 'environment-identity.json'), 'utf8'))
  const scenarioFile = path.join(state, 'scenario.json')
  const providerFile = path.join(state, 'provider-state.json')
  const scenarioHash = hashFile(scenarioFile)
  const providerHash = hashFile(providerFile)
  const scenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'))
  const sourceEvent = sourceEventFromScenario(scenario)
  const organizer = uuid(scenario.organizerId)
  const instance = uuid(environment.instanceId)
  const parameters = { sourceEvent, organizer, instance }
  const before = dbJson(`select jsonb_build_object('title',title,'venue',venue_name,'address',address_line1,
    'digest',encode(extensions.digest((to_jsonb(events)-'updated_at')::text,'sha256'),'hex')) from public.events where id=${quote(sourceEvent)} and organizer_id=${quote(organizer)};`)
  if (!before?.title || !before?.venue || !before?.address) throw new Error('Eligible source facts unavailable')
  const sequenceBefore = dbJson("select jsonb_build_object('lastValue',last_value::text,'isCalled',is_called) from private.event_change_snapshots_snapshot_version_seq;")
  const out = path.join(state, 'j06-legacy-history-' + Date.now())
  fs.mkdirSync(out, { mode: 0o700 })
  const reportFile = path.join(out, 'report.json')
  let browser = null
  let setup = false
  let cleanup = 'not-needed'
  let stage = 'setup'
  let outcome = 'partial'
  let failure = null
  let observed = null
  let sequenceAfter = null
  const writers = []
  const blocked = []
  const pageErrors = []
  const save = () => fs.writeFileSync(reportFile, JSON.stringify({
    startedAt, finishedAt: new Date().toISOString(), outcome, failure, stage, identity, sourceHashes,
    fixtureIds, sourceEvent, setup, cleanup, observed, writerRequests: writers, blockedRequests: blocked.length,
    pageErrors: pageErrors.map(error => error.name), scenarioPreserved: hashFile(scenarioFile) === scenarioHash,
    providerPreserved: hashFile(providerFile) === providerHash,
    snapshotSequence: { before: sequenceBefore, after: sequenceAfter, disposition: 'The real first-read snapshot consumes one ordinary identity value. Cleanup removes the fixture rows and does not rewind the shared sequence.' },
    scope: 'Temporary fixed-ID clone of one original eligible organizer event; no tiers, orders, registrations, tickets, notices, provider actions, principal edits, migration or policy change. Session replication role is local to guarded setup/cleanup transactions and restored before the real browser read.',
  }, null, 2), { mode: 0o600 })
  const startedAt = new Date().toISOString()
  save()
  try {
    sql(setupSql(parameters)); setup = true; cleanup = 'pending'; save()
    stage = 'browser'
    browser = await chromium.launch({ args: ['--no-proxy-server'] })
    const context = await browser.newContext({ storageState: path.join(state, 'browser-organizer.json'), viewport: { width: 390, height: 960 }, reducedMotion: 'reduce' })
    context.setDefaultTimeout(40_000)
    blocked.push(...await providerBoundaries(context, { allowProviderActions: false }))
    await context.route('**/*', route => {
      const label = businessWriter(route.request())
      if (!label) return route.fallback()
      writers.push(label); return route.abort('blockedbyclient')
    })
    const page = await context.newPage()
    page.on('pageerror', error => pageErrors.push({ name: error.name }))
    await page.goto(origin + `/organizer/events/${fixtureIds.event}/changes`, { waitUntil: 'networkidle' })
    stage = 'browser:heading'
    await expect(page.getByRole('heading', { name: 'Previous → New', exact: true })).toBeVisible()
    stage = 'browser:previous-saved'
    await expect(page.getByText('Previous saved unavailable. Earlier details were not recorded; no previous dates or location are assumed.', { exact: true })).toBeVisible()
    stage = 'browser:previous-public'
    await expect(page.getByText('Previous public unavailable. Earlier details were not recorded; no previous dates or location are assumed.', { exact: true })).toBeVisible()
    stage = 'browser:title'
    await expect(page.locator('.event-changes > header').getByText(before.title, { exact: true })).toBeVisible()
    const savedHistory = page.locator('.event-change-section').filter({ has: page.getByRole('heading', { name: 'Saved changes', exact: true }) })
    const publicHistory = page.locator('.event-change-section').filter({ has: page.getByRole('heading', { name: 'Actual public history', exact: true }) })
    stage = 'browser:current-saved-details'
    await savedHistory.getByText('View current saved details', { exact: true }).click()
    await expect(savedHistory.getByText(before.venue, { exact: true })).toBeVisible()
    await expect(savedHistory.getByText(before.address, { exact: true })).toBeVisible()
    stage = 'browser:current-public-details'
    await publicHistory.getByText('View latest actual public details', { exact: true }).click()
    await expect(publicHistory.getByText(before.venue, { exact: true })).toBeVisible()
    await expect(publicHistory.getByText(before.address, { exact: true })).toBeVisible()
    await context.close()
    if (writers.length || blocked.length || pageErrors.length) throw new Error('Unexpected writer, outbound boundary, or page error')
    stage = 'database-observation'
    observed = fixtureState(sourceEvent)
    validateObservedState(observed)
    const sourceAfter = dbJson(`select jsonb_build_object('digest',encode(extensions.digest((to_jsonb(events)-'updated_at')::text,'sha256'),'hex')) from public.events where id=${quote(sourceEvent)};`)
    if (sourceAfter.digest !== before.digest) throw new Error('Original source event changed')
    if (JSON.stringify(verificationSourceHashes(runner)) !== JSON.stringify(sourceHashes)) throw new Error('Verification source changed during execution')
    if (hashFile(scenarioFile) !== scenarioHash || hashFile(providerFile) !== providerHash) throw new Error('Scenario or provider state changed')
    outcome = 'passed'
  } catch (error) {
    failure = { name: error.name, stage, detail: String(error.message).slice(0, 8_000) }
    throw error
  } finally {
    await browser?.close()
    if (setup) {
      try { stage = 'cleanup'; sql(cleanupSql(parameters)); cleanup = 'passed' }
      catch (error) { cleanup = 'failed'; outcome = 'partial'; failure ??= { name: error.name, stage } }
    }
    try { sequenceAfter = dbJson("select jsonb_build_object('lastValue',last_value::text,'isCalled',is_called) from private.event_change_snapshots_snapshot_version_seq;") } catch { sequenceAfter = null }
    save()
  }
  if (cleanup !== 'passed') throw new Error('Legacy fixture cleanup failed')
  console.log(JSON.stringify({ directory: path.basename(out), outcome, cleanup, writerRequests: writers.length, blockedRequests: blocked.length, pageErrors: pageErrors.length }))
}

module.exports = { businessWriter, cleanupSql, fixtureIds, setupSql, sourceEventFromScenario, validateObservedState }
if (require.main === module) main().catch(() => {
  console.error('J06 legacy-history negative control failed; inspect the private report.')
  process.exitCode = 1
})
