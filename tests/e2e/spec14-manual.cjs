#!/usr/bin/env node
/**
 * Manual Spec14 browser using the same task-only provider boundary as E2E.
 * It preserves the local database and a dedicated browser profile.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

require('tsx/cjs')
const { chromium } = require('@playwright/test')
const harness = require('./support/spec14Harness.ts')
const { verifyRunningTask } = require('./spec14-control.cjs')

const root = path.resolve(__dirname, '../..')
const state = path.join(root, '.superpowers/spec14')
const ticketOrigin = 'https://ticket-inbox.spec14.invalid'
const roles = new Set(['organizer', 'paid-buyer', 'free-buyer', 'staff'])

function requireCondition(value, message) {
  if (!value) throw new Error(message)
}

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
}

function safeText(value) {
  return String(value ?? '')
    .replace(/https?:\/\/\S+/gi, '[private link]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 180)
}

function escapeHtml(value) {
  return safeText(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function localTicketLinks(payload) {
  const serialized = JSON.stringify(payload ?? {}).replaceAll('&amp;', '&')
  const candidates = serialized.match(/https?:\/\/[^\s"'<>\\]+/g) ?? []
  const links = []
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.replace(/[),.;]+$/, ''))
      if (url.origin === harness.origin && !links.includes(url.href)) links.push(url.href)
    } catch { /* Ignore malformed provider text. */ }
  }
  return links
}

function inboxPage(messages, notice = '') {
  const rows = messages.slice().reverse().map((message, index) => {
    const links = localTicketLinks(message.payload)
    const subject = message.payload && typeof message.payload === 'object'
      ? message.payload.subject : 'Ticket delivery'
    const actions = links.map((_, link) => `<a href="/open/${index}/${link}">Open local ticket destination ${link + 1}</a>`).join(' ')
    return `<li><strong>${escapeHtml(subject || 'Ticket delivery')}</strong><br><span>${escapeHtml(message.mode)} · ${escapeHtml(message.createdAt)}</span><br>${actions || '<em>No local ticket destination in this delivery.</em>'}</li>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Spec14 ticket inbox</title><style>body{font:16px system-ui;max-width:800px;margin:40px auto;padding:0 24px;color:#172033}a{display:inline-block;margin:8px 12px 0 0}li{margin:20px 0;padding:16px;border:1px solid #ccd3df;border-radius:8px}span,em{color:#596579}</style></head><body><h1>Ticket delivery inbox</h1><p>This task-only view lists simulated ticket deliveries. Private ticket destinations stay in the Node controller and open directly in the app tab.</p>${notice ? `<p role="status">${escapeHtml(notice)}</p>` : ''}<p><a href="/">Refresh ticket deliveries</a></p><ol>${rows || '<li>No simulated ticket deliveries yet.</li>'}</ol></body></html>`
}

function readIdentity() {
  const identity = JSON.parse(fs.readFileSync(path.join(state, 'environment-identity.json'), 'utf8'))
  const processes = JSON.parse(fs.readFileSync(path.join(state, 'processes.json'), 'utf8'))
  requireCondition(identity.task === 'spec14-final-assembly', 'Wrong task identity')
  requireCondition(path.resolve(identity.root) === root, 'Task identity belongs to another checkout')
  requireCondition(processes.instanceId === identity.instanceId, 'Process registry belongs to another instance')
  requireCondition(Array.isArray(processes.processes) && processes.processes.length === 3 &&
    new Set(processes.processes.map(row => row.name)).size === 3 &&
    processes.processes.every(row => ['app', 'bridge', 'edge'].includes(row.name)), 'Task servers are not completely recorded')
  return identity
}

async function requireJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  requireCondition(response.ok, 'Required local service is unavailable')
  return response.json()
}

async function readiness(identity) {
  const [gateway, application, auth] = await Promise.all([
    requireJson('http://127.0.0.1:55647/health'),
    requireJson(harness.origin + '/__spec14/identity'),
    requireJson('http://127.0.0.1:55649/api/v1/messages'),
  ])
  requireCondition(gateway.status === 'ready' && gateway.functions === 22, 'Real-handler gateway is incomplete')
  requireCondition(application.task === identity.task && application.instanceId === identity.instanceId, 'Application serves another task identity')
  requireCondition(application.application === harness.origin && application.providers === 'local simulation only', 'Application provider boundary is incorrect')
  requireCondition(Array.isArray(auth.messages), 'Separate Auth inbox is unavailable')
}

function rolePaths(role, purpose = 'launch') {
  requireCondition(roles.has(role), 'Manual browser role must be organizer, paid-buyer, free-buyer, or staff')
  requireCondition(purpose === 'launch' || purpose === 'smoke', 'Manual browser purpose must be launch or smoke')
  const stem = purpose === 'smoke' ? `manual-browser-smoke-${role}` : `manual-browser-${role}`
  return {
    profile: path.join(state, `${stem}-profile`),
    active: path.join(state, `${stem}-active.json`),
  }
}

function startPath(role) {
  requireCondition(roles.has(role), 'Manual browser role must be organizer, paid-buyer, free-buyer, or staff')
  return role === 'staff' ? '/moderation' : role === 'organizer' ? '/organizer/events' : '/discover'
}

function claimProfile(identity, role, purpose) {
  const paths = rolePaths(role, purpose)
  privateDirectory(state)
  privateDirectory(paths.profile)
  if (fs.existsSync(paths.active)) {
    try {
      const record = JSON.parse(fs.readFileSync(paths.active, 'utf8'))
      process.kill(record.pid, 0)
      throw new Error('Manual task browser is already running')
    } catch (error) {
      if (error && error.message === 'Manual task browser is already running') throw error
      fs.unlinkSync(paths.active)
    }
  }
  fs.writeFileSync(paths.active, JSON.stringify({ pid: process.pid, instanceId: identity.instanceId, role, purpose }) + '\n', { mode: 0o600, flag: 'wx' })
  fs.chmodSync(paths.active, 0o600)
  return paths
}

async function withRoleBrowser(role, purpose, run, dependencies = {}) {
  const verifyRunning = dependencies.verifyRunning || verifyRunningTask
  const getIdentity = dependencies.readIdentity || readIdentity
  const checkReadiness = dependencies.readiness || readiness
  const claim = dependencies.claimProfile || claimProfile
  const launchPersistentContext = dependencies.launchPersistentContext || chromium.launchPersistentContext.bind(chromium)
  await verifyRunning()
  const identity = getIdentity()
  await checkReadiness(identity)
  const paths = claim(identity, role, purpose)
  let context
  try {
    context = await launchPersistentContext(paths.profile, {
      headless: false,
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    })
    const blocked = await harness.providerBoundaries(context)
    const pages = context.pages()
    const app = pages[0] ?? await context.newPage()
    const appResponse = await app.goto(harness.origin + startPath(role))
    requireCondition(appResponse && appResponse.ok(), 'Application tab failed to load')

    await context.route(ticketOrigin + '/**', async route => {
      const request = new URL(route.request().url())
      const inbox = await harness.control({ action: 'inbox' })
      const messages = Array.isArray(inbox.messages) ? inbox.messages : []
      let notice = ''
      const match = request.pathname.match(/^\/open\/(\d+)\/(\d+)$/)
      if (match) {
        const reversed = messages.slice().reverse()
        const message = reversed[Number(match[1])]
        const link = message && localTicketLinks(message.payload)[Number(match[2])]
        requireCondition(link, 'Ticket destination is no longer available; refresh the inbox')
        await app.goto(link)
        await app.bringToFront()
        notice = 'The selected ticket destination opened in the app tab.'
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
        body: inboxPage(messages, notice),
      })
    })

    const authInbox = await context.newPage()
    const authResponse = await authInbox.goto('http://127.0.0.1:55649')
    requireCondition(authResponse && authResponse.ok(), 'Auth inbox tab failed to load')
    const ticketInbox = await context.newPage()
    const ticketResponse = await ticketInbox.goto(ticketOrigin + '/')
    requireCondition(ticketResponse && ticketResponse.ok(), 'Ticket inbox tab failed to load')
    await app.bringToFront()
    return await run({ app, authInbox, blocked, context, identity, ticketInbox })
  } finally {
    if (context) await context.close().catch(() => {})
    if (fs.existsSync(paths.active)) {
      const record = JSON.parse(fs.readFileSync(paths.active, 'utf8'))
      if (record.pid === process.pid && record.instanceId === identity.instanceId && record.role === role && record.purpose === purpose) fs.unlinkSync(paths.active)
    }
    if (purpose === 'smoke') fs.rmSync(paths.profile, { recursive: true, force: true })
  }
}

async function launch(role) {
  await withRoleBrowser(role, 'launch', async ({ context }) => {
    console.log(`Spec14 ${role} browser ready. App, Auth inbox, and ticket delivery inbox are open in separate tabs. Keep buyer tabs open during an in-progress checkout: cookies and local storage use the task profile, but browser exit does not guarantee session-storage retry proof. Close the browser to finish; database data is preserved.`)
    await new Promise(resolve => context.once('close', resolve))
  })
}

function smokeProof(role, result) {
  return {
    role,
    applicationIdentityMatches: result.appIdentityMatches === true,
    tabs: {
      application: result.tabs.application === true,
      authInbox: result.tabs.authInbox === true,
      ticketInbox: result.tabs.ticketInbox === true,
    },
    providerStateUnchanged: result.providerStateUnchanged === true,
    blockedRequestCount: result.blocked.length,
  }
}

function writeSmokeProof(role, proof) {
  privateDirectory(state)
  const proofPath = path.join(state, `manual-launcher-smoke-${role}.json`)
  fs.writeFileSync(proofPath, JSON.stringify({ completedAt: new Date().toISOString(), ...proof }, null, 2) + '\n', { mode: 0o600 })
  fs.chmodSync(proofPath, 0o600)
}

async function smoke(role) {
  await withRoleBrowser(role, 'smoke', async ({ app, authInbox, blocked, identity, ticketInbox }) => {
    const providerBefore = await harness.control({ action: 'state' })
    const applicationIdentity = await app.evaluate(async () => {
      const response = await fetch('/__spec14/identity', { headers: { accept: 'application/json' } })
      return response.ok ? response.json() : null
    })
    const tabs = {
      application: new URL(app.url()).origin === harness.origin,
      authInbox: new URL(authInbox.url()).origin === 'http://127.0.0.1:55649',
      ticketInbox: new URL(ticketInbox.url()).origin === ticketOrigin && await ticketInbox.title() === 'Spec14 ticket inbox',
    }
    const appIdentityMatches = applicationIdentity?.task === identity.task && applicationIdentity?.instanceId === identity.instanceId
    requireCondition(appIdentityMatches, 'Application tab identity does not match the recorded task')
    requireCondition(Object.values(tabs).every(Boolean), 'Manual browser tabs are incomplete')
    const providerAfter = await harness.control({ action: 'state' })
    const providerStateUnchanged = JSON.stringify(providerAfter) === JSON.stringify(providerBefore)
    requireCondition(providerStateUnchanged, 'Provider state changed during the read-only smoke')
    writeSmokeProof(role, smokeProof(role, { appIdentityMatches, blocked, providerStateUnchanged, tabs }))
  })
  console.log(`Spec14 ${role} headed launcher smoke passed; three local tabs and task identity verified, and the smoke context closed.`)
}

function parseCommand(arguments_) {
  const [action, role = 'organizer', ...extra] = arguments_
  if (!['launch', 'smoke'].includes(action) || extra.length) {
    throw new Error('Usage: node tests/e2e/spec14-manual.cjs check|launch|smoke [organizer|paid-buyer|free-buyer|staff]')
  }
  requireCondition(roles.has(role), 'Manual browser role must be organizer, paid-buyer, free-buyer, or staff')
  return { action, role }
}

function check() {
  assert.equal(harness.origin, 'http://127.0.0.1:3040')
  assert.equal(typeof harness.providerBoundaries, 'function')
  assert.equal(typeof harness.control, 'function')
  assert.match(rolePaths('organizer').profile, /manual-browser-organizer-profile$/)
  assert.match(rolePaths('paid-buyer').active, /manual-browser-paid-buyer-active\.json$/)
  assert.match(rolePaths('free-buyer', 'smoke').profile, /manual-browser-smoke-free-buyer-profile$/)
  assert.match(rolePaths('staff').profile, /manual-browser-staff-profile$/)
  assert.equal(startPath('staff'), '/moderation')
  assert.throws(() => rolePaths('../escape'), /role must be/)
  const privateUrl = harness.origin + '/tickets/order/private-proof?access=credential'
  const links = localTicketLinks({ subject: privateUrl, html: `<a href="${privateUrl}">Ticket</a>`, external: 'https://example.com/escape' })
  assert.deepEqual(links, [privateUrl])
  const page = inboxPage([{ mode: 'accepted', createdAt: '2026-09-14T00:00:00Z', payload: { subject: privateUrl, html: `<a href="${privateUrl}">Ticket</a>` } }])
  assert.doesNotMatch(page, /credential|example\.com/)
  assert.match(page, /Open local ticket destination 1/)
  console.log('Spec14 manual launcher static checks passed.')
}

module.exports = { inboxPage, localTicketLinks, parseCommand, rolePaths, safeText, smokeProof, startPath, withRoleBrowser }

if (require.main === module) {
  const action = process.argv[2]
  if (action === 'check') check()
  else {
    let command
    try {
      command = parseCommand(process.argv.slice(2))
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Invalid manual browser command')
      process.exitCode = 2
    }
    if (command) (command.action === 'launch' ? launch(command.role) : smoke(command.role)).catch(error => {
      console.error('Spec14 manual browser failed: ' + (error instanceof Error ? error.name : 'Unknown error'))
      process.exitCode = 1
    })
  }
}
