import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sanitizeSpec14Evidence } from '../spec14-reporter'
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

export const origin = 'http://127.0.0.1:3040'
export const statePath = resolve('.superpowers/spec14')
export const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
export function sql(statement: string) {
  return execFileSync('python3', ['tests/integration/spec14-local.py', 'sql'], {
    cwd: resolve('.'), input: '\\pset tuples_only on\n\\pset format unaligned\n' + statement,
    encoding: 'utf8', timeout: 120_000,
  }).trim()
}
export function dbJson<T>(statement: string): T {
  const lines = sql(statement).split('\n')
  const value = lines.findLast(line => line.startsWith('{') || line.startsWith('['))
  if (!value) throw new Error('Expected a JSON database result')
  return JSON.parse(value) as T
}
export async function control<T = Record<string, unknown>>(input: Record<string, unknown>): Promise<T> {
  const secret = JSON.parse(readFileSync(resolve(statePath, 'local-secrets.json'), 'utf8')) as { workerSecret: string }
  const response = await fetch('http://127.0.0.1:55647/__spec14/control', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-spec14-control': secret.workerSecret }, body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error('Local provider control failed: ' + response.status + ' ' + await response.text())
  return await response.json() as T
}
// These explicit negative authorities operate only on separate grant metadata.
// Original access proof travels through stdin/private files, never process args.
export function negativeGrant(input: { action: 'expired'; alias: string } | { action: 'revoke'; alias: string; token: string }) {
  const output = execFileSync('python3', ['tests/integration/spec14-grant-controls.py'], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 120_000,
  })
  const result = JSON.parse(output) as { evidence: string; status: string }
  const record = JSON.parse(readFileSync(resolve(result.evidence), 'utf8')) as { token?: string; grantId: string }
  return { ...result, ...record }
}
export type Scenario = {
  runId: string; organizerEmail: string; organizerPassword: string; organizerId?: string;
  paidEventId?: string; freeEventId?: string; paidOrderId?: string; freeRegistrationId?: string;
  paidBuyerUrl?: string; freeBuyerUrl?: string; paidTicketIds?: string[]; freeTicketIds?: string[];
  results: Record<string, unknown>;
  events?: Record<string, { id?: string; title: string; admission: 'paid' | 'free'; tierIds?: string[] }>;
  attempts?: { journey: string; startedAt: string; endedAt?: string; outcome: 'running' | 'passed' | 'failed'; note?: string }[];
}
export function newScenario(): Scenario {
  const runId = randomUUID().slice(0, 8)
  const scenario = { runId, organizerEmail: `organizer-${runId}@spec14.test`, organizerPassword: 'Local-only-' + randomUUID(), results: {} }
  if (existsSync(resolve(statePath, 'scenario.json'))) throw new Error('Scenario already exists; resume it or explicitly archive it after review. No automatic reset.')
  saveScenario(scenario)
  return scenario
}
export function saveScenario(scenario: Scenario) {
  writeFileSync(resolve(statePath, 'scenario.json'), JSON.stringify(scenario, null, 2) + '\n', { mode: 0o600 })
  chmodSync(resolve(statePath, 'scenario.json'), 0o600)
}

const featureProperties = JSON.parse(readFileSync(resolve('tests/e2e/support/spec14-address-fixture.json'), 'utf8'))

// Replaces only the downloaded provider script. The application's installed
// Connect loader and its real account-session/status handlers still execute.
export const connectScript = `
window.StripeConnect = { init(params) {
  const ready = params.metaOptions.eagerClientSecretPromise;
  for (const name of ['account-onboarding', 'account-management', 'notification-banner']) {
    const tag = 'stripe-connect-' + name;
    if (!customElements.get(tag)) customElements.define(tag, class extends HTMLElement {
      setConnector() { if (name === 'notification-banner') return; this.innerHTML = '<p>Local Stripe setup simulator — no provider connection.</p><button type="button">Complete simulated Stripe setup</button>'; this.querySelector('button').disabled = typeof window.__spec14Provider !== 'function'; this.querySelector('button').onclick = async () => { if (typeof window.__spec14Provider !== 'function') return; await window.__spec14Provider({action:'connect-ready',clientSecret:await ready}); this.exit?.(); }; }
      setOnExitInternalOnly(value) { this.exit = value; }
      setOnLoadErrorInternalOnly() {} setOnLoaderStartInternalOnly() {}
      setOnStepChangeInternalOnly() {} setCollectionOptionsInternalOnly() {}
      setOnSectionOpenInternalOnly() {}
      setRecipientTermsOfServiceUrlInternalOnly() {} setFullTermsOfServiceUrlInternalOnly() {}
      setPrivacyPolicyUrlInternalOnly() {} setSkipTermsOfServiceCollectionInternalOnly() {}
      setOnNotificationsChangeInternalOnly() {}
    });
  }
  return {connect:{}, update(){}, logout(){return Promise.resolve();}};
}};
`

export async function providerBoundaries(context: BrowserContext, options: { allowProviderActions?: boolean } = {}) {
  const allowProviderActions = options.allowProviderActions !== false
  const blocked: string[] = []
  if (allowProviderActions) await context.exposeBinding('__spec14Provider', async ({ page }, input: Record<string, unknown>) => {
    const host = new URL(page.url()).hostname
    if (!['127.0.0.1', 'checkout.stripe.com'].includes(host)) throw new Error('Unsupported simulator caller')
    if (!['connect-ready', 'checkout-complete', 'checkout-cancel'].includes(String(input.action))) throw new Error('Unsupported simulator action')
    return control(input)
  })
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue()
    if (url.hostname === '127.0.0.1' && ['3040', '55647', '55649'].includes(url.port)) return route.continue()
    if (url.hostname === 'api.mapbox.com' && url.pathname.startsWith('/search/searchbox/')) {
      const body = url.pathname.includes('/suggest')
        ? { suggestions: [{ ...featureProperties, distance: 0 }], attribution: 'Local synthetic address response' }
        : { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-122.3958, 37.7936] }, properties: featureProperties }], attribution: 'Local synthetic address response' }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    if (url.hostname === 'events.mapbox.com') return route.fulfill({ status: 204 })
    if (url.hostname === 'connect-js.stripe.com' && url.pathname.endsWith('/connect.js')) return route.fulfill({ contentType: 'application/javascript', body: connectScript })
    if (url.hostname === 'checkout.stripe.com') {
      if (!allowProviderActions) return route.fulfill({ status: 403, contentType: 'text/html', body: '<!doctype html><title>Provider actions disabled</title><main><h1>Provider actions are disabled in this read-only browser.</h1></main>' })
      const sessionId = url.pathname.split('/').at(-1)
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Local Stripe checkout simulator</title><main><h1>Local checkout simulator</h1><p>No Stripe transaction or card details are used.</p><button id="pay">Complete simulated payment</button><button id="cancel">Cancel checkout</button><p id="status" role="status"></p></main><script>const id=${JSON.stringify(sessionId)};for(const [button,action] of [['pay','checkout-complete'],['cancel','checkout-cancel']])document.getElementById(button).onclick=async()=>{document.getElementById('status').textContent='Processing through the real local webhook…';try{const result=await window.__spec14Provider({action,sessionId:id});location.href=result.successUrl||result.cancelUrl;}catch(e){document.getElementById('status').textContent='Simulation failed; original attempt retained.';}};</script>` })
    }
    blocked.push(url.origin + url.pathname)
    return route.abort('blockedbyclient')
  })
  return blocked
}

export async function confirmLocalSignup(page: Page, email: string) {
  await expect.poll(async () => {
    const response = await fetch('http://127.0.0.1:55649/api/v1/messages')
    const value = await response.json() as { messages: { To: { Address: string }[] }[] }
    return value.messages.some(row => row.To.some(recipient => recipient.Address === email))
  }, { message: 'Waiting for the separate local Auth inbox' }).toBe(true)
  const response = await fetch('http://127.0.0.1:55649/api/v1/messages')
  const data = await response.json() as { messages: { ID: string; To: { Address: string }[] }[] }
  const message = data.messages.find(row => row.To.some(recipient => recipient.Address === email))
  if (!message) throw new Error('Local Auth confirmation has not arrived')
  const detail = await (await fetch('http://127.0.0.1:55649/api/v1/message/' + message.ID)).json() as { HTML: string; Text: string }
  const link = (detail.HTML + '\n' + detail.Text).match(/http:\/\/127\.0\.0\.1:55647\/auth\/v1\/verify[^\s"<>]+/)?.[0].replaceAll('&amp;', '&')
  if (!link) throw new Error('No task Auth verification link')
  await page.goto(link)
  await expect.poll(() => new URL(page.url()).pathname).toBe('/organizer/setup')
}

export function scenario(): Scenario {
  return existsSync(resolve(statePath, 'scenario.json'))
    ? JSON.parse(readFileSync(resolve(statePath, 'scenario.json'), 'utf8')) as Scenario : newScenario()
}
export async function journey(name: string, run: (value: Scenario) => Promise<void>) {
  const value = scenario()
  const attempt = { journey: name, startedAt: new Date().toISOString(), outcome: 'running' as 'running' | 'passed' | 'failed', endedAt: undefined as string | undefined, note: undefined as string | undefined }
  ;(value.attempts ??= []).push(attempt)
  saveScenario(value)
  try { await run(value); attempt.outcome = 'passed' }
  catch (error) {
    attempt.outcome = 'failed'
    // Evidence never copies browser URLs, access credentials or request bodies.
    attempt.note = error instanceof Error ? error.name : 'Unknown failure'
    throw error
  } finally { attempt.endedAt = new Date().toISOString(); saveScenario(value) }
}
export function requireId(value: string | undefined, name: string): string {
  if (!value || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error(name + ' is absent; run its earlier journey. The harness will not seed a replacement.')
  return value
}
export async function privateGoto(page: Page, url: string) {
  try { await page.goto(url) } catch { throw new Error('Private application navigation failed; original proof retained in private ledger') }
}
export async function realContext(browser: Browser, role: string) {
  const path = resolve(statePath, 'browser-' + role + '.json')
  const context = await browser.newContext({ ...(existsSync(path) ? { storageState: path } : {}), viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  context.setDefaultTimeout(40_000)
  context.setDefaultNavigationTimeout(40_000)
  const blocked = await providerBoundaries(context)
  const page = await context.newPage()
  page.on('pageerror', error => process.stderr.write(sanitizeSpec14Evidence('Browser runtime error: ' + error.message) + '\n'))
  const sessionPath = resolve(statePath, 'browser-' + role + '-guest-session.json')
  // Playwright storageState omits sessionStorage. Retain only actual guest retry
  // records; never invent, alter or restore an organizer Auth token here.
  const retained = existsSync(sessionPath) ? JSON.parse(readFileSync(sessionPath, 'utf8')) as Record<string, string> : {}
  if (Object.keys(retained).length) {
    await page.goto(origin + '/')
    await page.evaluate(saved => { for (const [key, item] of Object.entries(saved)) sessionStorage.setItem(key, item) }, retained)
  }
  const captureGuestSession = async () => {
    if (new URL(page.url()).origin !== origin) return
    const saved = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith('whereto.checkout-attempt.v1:') || key.startsWith('wheretoo:ticket-') || key.startsWith('wheretoo:event-notice:v1:'))))
    writeFileSync(sessionPath, JSON.stringify(saved) + '\n', { mode: 0o600 }); chmodSync(sessionPath, 0o600)
  }
  // Read before provider navigation while the application has already persisted
  // its request identity. No application response or request body is replaced.
  await page.route('**/functions/v1/stripe-create-checkout', async route => { await captureGuestSession(); await route.fallback() })
  return { context, page, blocked, async close() {
    const bodyPath = resolve(statePath, 'browser-' + role + '-last-body.txt')
    const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => 'No rendered body available')
    writeFileSync(bodyPath, sanitizeSpec14Evidence(body), { mode: 0o600 }); chmodSync(bodyPath, 0o600)
    await captureGuestSession()
    await context.storageState({ path }); chmodSync(path, 0o600); await context.close()
  } }
}
export async function organizerLogin(page: Page, value: Scenario) {
  if (value.organizerId && typeof value.results.pendingOrganizerEmail === 'string') {
    const canonical = dbJson<{ email: string }>(`select jsonb_build_object('email',email) from auth.users where id=${quote(value.organizerId)};`)
    if (canonical.email === value.results.pendingOrganizerEmail) { value.organizerEmail = canonical.email; saveScenario(value) }
  }
  await page.goto(origin + '/organizer/events')
  await expect(page.getByRole('heading', { name: /^(Sign in|My Events|No events yet|Organizer Profile)$/ })).toBeVisible()
  if (new URL(page.url()).pathname === '/auth/sign-in') {
    await page.getByLabel('Email', { exact: true }).fill(value.organizerEmail)
    const pendingPassword = typeof value.results.pendingOrganizerPassword === 'string' ? value.results.pendingOrganizerPassword : undefined
    await page.getByLabel('Password', { exact: true }).fill(pendingPassword ?? value.organizerPassword)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    if (pendingPassword && pendingPassword !== value.organizerPassword) {
      await expect.poll(async () => new URL(page.url()).pathname.startsWith('/organizer/') || await page.getByText('Sign in failed', { exact: true }).isVisible(), { message: 'Resolve the retained password-update outcome through real login' }).toBe(true)
      if (new URL(page.url()).pathname.startsWith('/organizer/')) {
        value.organizerPassword = pendingPassword; value.results.J07PasswordConfirmedByLogin = true; saveScenario(value)
      } else {
        await page.getByLabel('Password', { exact: true }).fill(value.organizerPassword)
        await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      }
    }
    await page.waitForURL(url => url.pathname.startsWith('/organizer/'))
  }
}
export function wallMinute(instant: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}
export async function setupPayments(page: Page, eventId?: string) {
  await page.goto(origin + '/organizer/settings/payments' + (eventId ? '?eventId=' + eventId : ''))
  const ready = page.getByRole('heading', { name: 'You’re all set!', exact: true })
  const begin = page.getByRole('button', { name: /^(Set up payouts|Continue with Stripe|Continue setup|Review with Stripe)$/ })
  await expect.poll(async () => await ready.isVisible() || await begin.isVisible(), { message: 'Fresh Connect status is ready for the same-event flow' }).toBe(true)
  if (!await ready.isVisible()) {
    if (await page.getByRole('button', { name: 'Set up payouts', exact: true }).isVisible()) await page.getByRole('button', { name: 'Set up payouts', exact: true }).click()
    await page.getByRole('button', { name: /^(Continue with Stripe|Continue setup|Review with Stripe)$/ }).click()
    await page.getByRole('button', { name: 'Complete simulated Stripe setup', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'You’re all set!', exact: true })).toBeVisible()
}
export async function eventThroughUi(page: Page, value: Scenario, key: string, admission: 'paid' | 'free', options: { stopAtPreview?: boolean } = {}) {
  const events = value.events ??= {}
  const selected = events[key] ??= { title: `Spec14 ${key} ${value.runId}`, admission }
  saveScenario(value)
  const existing = dbJson<{ id: string; status: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status)), '[]'::jsonb) from public.events where organizer_id=${quote(requireId(value.organizerId, 'Organizer'))} and title=${quote(selected.title)};`)
  if (existing.length > 1) throw new Error('Multiple canonical events match ledger; manual reconciliation required')
  if (existing[0]) { selected.id = existing[0].id; saveScenario(value) }
  if (existing[0]?.status === 'published') {
    if (options.stopAtPreview) throw new Error('Negative draft is already published; preserve it and inspect history')
    return existing[0].id
  }
  if (existing[0] && existing[0].status !== 'draft') throw new Error('Existing event is terminal; do not replace it to retry a journey')
  await page.goto(origin + (selected.id ? `/organizer/events/${selected.id}/edit?step=basics` : '/organizer/events/new'))
  process.stdout.write('Creation stage: basics\n')
  await page.getByLabel('Event name', { exact: true }).fill(selected.title)
  await page.getByLabel('Description', { exact: true }).fill('A welcoming neighborhood community gathering with conversation and local activities. Local test event.')
  await page.getByLabel('Category', { exact: true }).selectOption('community')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  process.stdout.write('Creation stage: schedule and verified location\n')
  const start = new Date(Date.now() + 2 * 86_400_000)
  await page.getByLabel('Starts', { exact: true }).fill(wallMinute(start))
  await page.getByLabel('Ends', { exact: true }).fill(wallMinute(new Date(start.getTime() + 3 * 3_600_000)))
  await page.getByLabel('Venue name', { exact: true }).fill('Spec14 Community Hall')
  if (!await page.getByText('Verified address', { exact: true }).isVisible()) {
    await page.getByPlaceholder('Search for a California address').fill('1 Market Street')
    await page.getByRole('option').filter({ hasText: /1 Market Street/ }).first().click()
  }
  await expect(page.getByText('Verified address', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  process.stdout.write('Creation stage: admission type\n')
  await page.getByRole('radio', { name: admission === 'paid' ? /Paid Tickets/ : /Free RSVP/ }).check()
  if (admission === 'free') await page.getByLabel('Capacity (optional)', { exact: true }).fill('30')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.waitForURL(url => /\/organizer\/events\/[0-9a-f-]{36}\//.test(url.pathname))
  selected.id = new URL(page.url()).pathname.split('/')[3]
  saveScenario(value)
  if (admission === 'paid') {
    process.stdout.write('Creation stage: paid tiers\n')
    const cards = page.locator('.ticket-tier-card')
    await expect(page.getByRole('button', { name: 'Add ticket tier', exact: true })).toBeVisible()
    if (await cards.count() > 2) throw new Error('Original event has more than two tiers; preserve them for reconciliation')
    while (await cards.count() < 2) await page.getByRole('button', { name: 'Add ticket tier', exact: true }).click()
    await expect(cards).toHaveCount(2)
    for (const [index, name, price] of [[0, 'General Admission', '20.00'], [1, 'VIP', '35.00']] as const) {
      await cards.nth(index).getByLabel('Name', { exact: true }).fill(name)
      await cards.nth(index).getByLabel('Price for ' + name, { exact: true }).fill(price)
      await cards.nth(index).getByLabel('Capacity', { exact: true }).fill('20')
    }
    await page.getByRole('button', { name: 'Save ticket tiers', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save ticket tiers', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
  }
  process.stdout.write('Creation stage: requirements and agreement\n')
  await expect(page.getByRole('heading', { name: 'Organizer agreement', exact: true })).toBeVisible()
  for (const name of ['alcoholPresent', 'cannabisPresent', 'explicitAdultContent', 'gamblingPresent', 'weaponsPresent', 'highRiskActivity']) {
    await page.locator(`input[name="${name}"][value="false"]`).check()
  }
  await page.getByRole('checkbox', { name: /I confirm that this event information/ }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.waitForURL(url => url.pathname.endsWith('/preview'))
  if (options.stopAtPreview) {
    await expect(page.getByRole('heading', { name: 'Preview your event', exact: true })).toBeVisible()
    expect(dbJson<{ status: string }>(`select jsonb_build_object('status',status) from public.events where id=${quote(selected.id)};`).status).toBe('draft')
    saveScenario(value)
    return selected.id
  }
  if (admission === 'paid') {
    selected.tierIds = dbJson<string[]>(`select jsonb_agg(id order by sort_order) from public.ticket_tiers where event_id=${quote(selected.id)};`)
    await setupPayments(page, selected.id)
    await page.goto(origin + `/organizer/events/${selected.id}/preview`)
  }
  await page.getByRole('button', { name: 'Publish event', exact: true }).click()
  const before = dbJson<{ status: string }>(`select jsonb_build_object('status',status) from public.events where id=${quote(selected.id)};`)
  expect(before.status).toBe('draft')
  await page.getByRole('button', { name: 'Confirm and publish', exact: true }).click()
  await expect.poll(() => dbJson<{ status: string }>(`select jsonb_build_object('status',status) from public.events where id=${quote(selected.id!)};`).status).toBe('published')
  await control({ action: 'run-worker', name: 'moderate-event-queue' })
  saveScenario(value)
  return selected.id
}
export type TicketFact = { id: string; status: string; usedAt: string | null; credentialHash: string; position: number }
export function ticketFacts(sourceId: string, free = false) {
  return dbJson<TicketFact[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'usedAt',used_at,'credentialHash',credential_hash,'position',unit_sequence) order by ${free ? 'unit_sequence' : 'order_item_id,unit_sequence'}), '[]'::jsonb) from public.tickets where ${free ? 'registration_id' : 'order_id'}=${quote(sourceId)};`)
}
export async function ticketQr(page: Page, collectionUrl: string, index: number) {
  await privateGoto(page, collectionUrl)
  const rows = page.locator('.buyer-wallet-row')
  await expect(rows).toHaveCount(3)
  await rows.nth(index).click()
  const qr = page.getByLabel('Admission QR code', { exact: true })
  await expect(qr).toHaveAttribute('data-qr-ready', 'true')
  return qr.evaluate(node => (node as HTMLCanvasElement).toDataURL())
}
// A generated ticket image enters the real production camera decoder. This does
// not replace the application's admission checker, handler or SQL writer.
export async function qrCamera(page: Page, qr: string) {
  await page.addInitScript(imageUrl => {
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [{ deviceId: 'spec14-qr-source', kind: 'videoinput', label: 'Local QR camera', groupId: 'spec14', toJSON() { return { deviceId: this.deviceId, kind: this.kind } } }] })
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const image = new Image(); image.src = imageUrl; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480
      const context = canvas.getContext('2d')!
      const draw = () => { context.fillStyle = 'white'; context.fillRect(0, 0, 640, 480); context.drawImage(image, 120, 40, 400, 400) }
      draw(); const stream = canvas.captureStream(10); const timer = setInterval(draw, 100)
      stream.getTracks().forEach(track => { const stop = track.stop.bind(track); track.stop = () => { clearInterval(timer); stop() } })
      return stream
    } })
  }, qr)
}

export async function localAuthMessages(email: string) {
  const response = await fetch('http://127.0.0.1:55649/api/v1/messages')
  const data = await response.json() as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] }
  const selected = data.messages.filter(row => row.To.some(recipient => recipient.Address.toLowerCase() === email.toLowerCase()))
  return Promise.all(selected.map(async row => {
    const detail = await (await fetch('http://127.0.0.1:55649/api/v1/message/' + row.ID)).json() as { HTML: string; Text: string }
    return { subject: row.Subject, body: detail.HTML + '\n' + detail.Text }
  }))
}
export async function confirmLocalEmailChange(page: Page, oldEmail: string, nextEmail: string) {
  const links = async () => {
    const messages = [...await localAuthMessages(oldEmail), ...await localAuthMessages(nextEmail)]
    return [...new Set(messages.flatMap(message => [...message.body.matchAll(/http:\/\/127\.0\.0\.1:55647\/auth\/v1\/verify[^\s"<>]+/g)].map(match => match[0].replaceAll('&amp;', '&'))).filter(link => new URL(link).searchParams.get('type') === 'email_change'))]
  }
  await expect.poll(async () => (await links()).length, { message: 'Local Auth email-change confirmation arrived' }).toBeGreaterThan(0)
  for (const link of await links()) await privateGoto(page, link)
}
