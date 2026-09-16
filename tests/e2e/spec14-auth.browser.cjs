// Isolated SDK/application Auth boundary proof. No provider requests escape this context.
const { createRequire } = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const req = createRequire(path.join(root, 'package.json'))
const { chromium } = req('@playwright/test')
const esbuild = req('./node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild')
;(async () => {
  const bundle = await esbuild.build({ stdin: { contents: `export { supabase } from './src/lib/supabase/client'; export { signInOrganizer, signUpOrganizer, signOut } from './src/features/auth/auth.api'; export { SessionProvider, useSession } from './src/features/auth/SessionProvider'; export { captureIdentityLifetime } from './src/features/auth/identityLifetime'; export { QueryClient } from '@tanstack/react-query'; export { createRoot } from 'react-dom/client'; export * as React from 'react';`, resolveDir: root }, bundle: true, format: 'iife', globalName: 'AppAuth', platform: 'browser', jsx: 'automatic', write: false, define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://auth-spec14.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_audit_dummy', VITE_MAPBOX_ACCESS_TOKEN: 'pk.synthetic', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_synthetic' }) } })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  let unexpected = 0
  const rows = []
  const pageErrors = []
  context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)))
  try {
    await context.route('**/*', route => {
      if (route.request().url().startsWith('https://spec14.invalid/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Spec14 Auth boundary proof</title>' })
      unexpected += 1
      return route.abort()
    })
    async function page(options = {}) {
      const result = await context.newPage()
      await result.goto('https://spec14.invalid/' + (options.callback ? '#' + new URLSearchParams({ access_token: 'synthetic-B', refresh_token: 'synthetic-refresh-B', expires_in: '3600', token_type: 'bearer', type: 'signup' }) : ''))
      await result.evaluate(({ noLocks, noBroadcastChannel, holdZeroTimers }) => {
        window.heldTimers = []
        if (holdZeroTimers) {
          const realSetTimeout = window.setTimeout.bind(window)
          window.setTimeout = (callback, delay, ...args) => delay === 0 ? (heldTimers.push(() => callback(...args)), -heldTimers.length) : realSetTimeout(callback, delay, ...args)
        }
        window.auditCalls = []
        window.auditEvents = []
        if (noLocks) Object.defineProperty(navigator, 'locks', { value: undefined })
        if (noBroadcastChannel) window.BroadcastChannel = undefined
        function user(label) { return { id: label === 'B' ? '00000000-0000-4000-8000-000000000002' : '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: label.toLowerCase() + '@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }
        window.fetch = async (input, options) => {
          const url = new URL(input)
          auditCalls.push(url.pathname + url.search)
          if (url.pathname === '/auth/v1/token' || url.pathname === '/auth/v1/signup') {
            const body = JSON.parse(options.body)
            if (window.holdSignIn && body.email?.startsWith('b')) { window.signInStarted = true; await new Promise(resolve => { window.releaseSignIn = resolve }) }
            if (window.holdRefresh && url.searchParams.get('grant_type') === 'refresh_token') { window.refreshStarted = true; await new Promise(resolve => { window.releaseRefresh = resolve }) }
            const label = (body.email || body.refresh_token || '').includes('B') || (body.email || '').startsWith('b') ? 'B' : 'A'
            return new Response(JSON.stringify({ access_token: 'synthetic-' + label + '-' + crypto.randomUUID(), refresh_token: 'synthetic-refresh-' + label + '-' + crypto.randomUUID(), token_type: 'bearer', expires_in: window.shortExpiry ? 120 : 3600, user: user(label) }), { status: 200, headers: { 'Content-Type': 'application/json' } })
          }
          if (url.pathname === '/auth/v1/user') return new Response(JSON.stringify(user('B')), { status: 200, headers: { 'Content-Type': 'application/json' } })
          if (url.pathname === '/auth/v1/logout') {
            window.logoutStarted = true
            await new Promise(resolve => { window.releaseLogout = resolve })
            return window.logoutError
              ? new Response(JSON.stringify({ message: 'Synthetic provider failure' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
              : new Response(null, { status: 204 })
          }
          throw new Error('Unexpected fetch ' + url.pathname)
        }
      }, options)
      await result.addScriptTag({ content: bundle.outputFiles[0].text })
      await result.evaluate(({ noUi }) => {
        AppAuth.supabase.auth.onAuthStateChange((event, session) => auditEvents.push({ event, user: session?.user.id ?? null }))
        if (noUi) return
        window.probeClient = new AppAuth.QueryClient()
        const target = document.createElement('div'); document.body.append(target)
        function Probe() { const state = AppAuth.useSession(); return AppAuth.React.createElement('p', { id: 'identity' }, state.user?.id ?? state.status) }
        AppAuth.createRoot(target).render(AppAuth.React.createElement(AppAuth.SessionProvider, { queryClient: probeClient }, AppAuth.React.createElement(Probe)))
      }, options)
      return result
    }
    if (!process.env.SPEC14_AUTH_CASES || process.env.SPEC14_AUTH_CASES === 'initial-refresh') {
      const initial = await page({ noUi: true })
      await initial.evaluate(() => AppAuth.supabase.auth.initialize())
      await initial.waitForTimeout(100)
      await initial.evaluate(async () => {
        window.shortExpiry = true
        await AppAuth.signInOrganizer({ email: 'a@example.invalid', password: 'synthetic-only' })
        const realNow = Date.now.bind(Date)
        Date.now = () => realNow() + 60_000
        window.holdRefresh = true
        window.subscriptionReadySettled = false
        window.subscriptionReady = AppAuth.supabase.auth.onAuthStateChange(() => {}).ready.then(result => { window.subscriptionReadySettled = true; return result })
      })
      await initial.waitForFunction(() => window.refreshStarted)
      await initial.waitForTimeout(100)
      const heldNames = await initial.evaluate(async () => (await navigator.locks.query()).held.map(lock => lock.name))
      rows.push({ scenario: 'public subscriber initial-session refresh retains coordination gate until its response settles', refreshPending: true, heldNames })
      assert.equal(heldNames.includes('lock:sb-auth-spec14-auth-token'), true, 'SDK initial-session refresh escaped the public custom lock')
      assert.equal(await initial.evaluate(() => subscriptionReadySettled), false)
      await initial.evaluate(() => releaseRefresh())
      assert.deepEqual(await initial.evaluate(() => subscriptionReady), {error:null})
      await initial.close()
    }
    for (const scenario of (process.env.SPEC14_AUTH_CASES && process.env.SPEC14_AUTH_CASES !== 'supported' ? [] : ['password sign-in', 'signup', 'remote failure', 'startup callback', 'tab closure', 'logout timeout', 'refresh'])) {
      const a = await page(), b = await page()
      await a.evaluate(() => AppAuth.signInOrganizer({ email: 'a@example.invalid', password: 'synthetic-only' }))
      await a.evaluate(async () => { window.expectedSession = (await AppAuth.supabase.auth.getSession()).data.session })
      await b.evaluate(() => AppAuth.supabase.auth.initialize())
      await a.evaluate(scenario => {
        window.logoutError = scenario === 'remote failure'
        window.logoutCompletion = AppAuth.signOut(expectedSession).catch(error => ({ error: error.message }))
      }, scenario)
      await a.waitForFunction(() => window.logoutStarted)
      let target = b
      if (scenario === 'startup callback') target = await page({ callback: true })
      await target.evaluate(scenario => {
        window.loginCompletion = (scenario === 'startup callback'
          ? AppAuth.supabase.auth.initialize()
          : scenario === 'refresh' ? AppAuth.supabase.auth.refreshSession()
          : scenario === 'signup' ? AppAuth.signUpOrganizer({ fullName: 'Synthetic B', email: 'b@example.invalid', password: 'synthetic-only' })
          : AppAuth.signInOrganizer({ email: 'b@example.invalid', password: 'synthetic-only' }))
          .then(value => ({ ok: true, error: !!value?.error }), error => ({ ok: false, message: error.message }))
      }, scenario)
      await target.waitForTimeout(100)
      const startedDuringLogout = await target.evaluate(() => auditCalls.some(url => /\/(token|signup|user)/.test(url)))
      if (scenario === 'tab closure') await a.close()
      else if (scenario !== 'logout timeout') await a.evaluate(async () => { releaseLogout(); await logoutCompletion })
      else await a.evaluate(() => logoutCompletion)
      const attempt = await target.evaluate(() => loginCompletion)
      if (scenario === 'logout timeout' && !attempt.ok) await target.evaluate(() => AppAuth.signInOrganizer({ email: 'b@example.invalid', password: 'synthetic-only' }))
      if (scenario === 'logout timeout') await a.evaluate(() => releaseLogout())
      const finalUser = await target.evaluate(async () => (await AppAuth.supabase.auth.getSession()).data.session?.user.id ?? null)
      rows.push({ scenario, startedDuringLogout, finalUser, attempt })
      assert.equal(startedDuringLogout, false, scenario + ': replacement mutation must wait for logout settlement')
      assert.equal(finalUser, scenario === 'refresh' ? null : '00000000-0000-4000-8000-000000000002', scenario + ': delayed logout must preserve replacement')
      if (!a.isClosed()) await a.close()
      await b.close()
      if (target !== b) await target.close()
    }
    if (process.env.SPEC14_AUTH_CASES !== 'ui') {
      const stale = await page(), replacement = await page()
      await stale.evaluate(() => AppAuth.signInOrganizer({ email: 'a@example.invalid', password: 'synthetic-only' }))
      await stale.evaluate(async () => { window.expectedSession = (await AppAuth.supabase.auth.getSession()).data.session })
      await replacement.evaluate(() => { window.holdSignIn = true; window.pendingSignIn = AppAuth.signInOrganizer({ email: 'b@example.invalid', password: 'synthetic-only' }) })
      await replacement.waitForFunction(() => window.signInStarted)
      await stale.evaluate(() => { window.pendingSignOut = AppAuth.signOut(expectedSession) })
      await replacement.evaluate(async () => { releaseSignIn(); await pendingSignIn })
      const queuedOutcome = await stale.evaluate(() => pendingSignOut)
      assert.deepEqual(queuedOutcome, { localSignedOut: false, remoteRevoked: false, sessionChanged: true })
      assert.equal(await stale.evaluate(() => !!window.logoutStarted), false)
      const queuedUser = await replacement.evaluate(async () => (await AppAuth.supabase.auth.getSession()).data.session?.user.id ?? null)
      rows.push({ scenario: 'A logout queued behind in-flight B sign-in', finalUser: queuedUser, outcome: queuedOutcome })
      assert.equal(queuedUser, '00000000-0000-4000-8000-000000000002', 'a logout initiated while UI was A must not revoke replacement B')
      await stale.close(); await replacement.close()
    }
    const cycleA = await page(), cycleB = await page()
    await cycleA.evaluate(() => AppAuth.signInOrganizer({ email: 'a@example.invalid', password: 'synthetic-only' }))
    await cycleA.waitForFunction(() => document.querySelector('#identity')?.textContent?.endsWith('0001'))
    await cycleA.evaluate(() => {
      window.oldContinuation = AppAuth.captureIdentityLifetime(probeClient, '00000000-0000-4000-8000-000000000001')
      probeClient.setQueryData(['account', 'a'], 'A private')
      for (const scope of ['ticket-collection', 'ticket-email-access', 'refund-details']) probeClient.setQueryData([scope, 'guest'], 'guest grant')
    })
    await cycleB.evaluate(() => AppAuth.signInOrganizer({ email: 'b@example.invalid', password: 'synthetic-only' }))
    await cycleA.waitForFunction(() => document.querySelector('#identity')?.textContent?.endsWith('0002'))
    await cycleB.evaluate(() => AppAuth.signInOrganizer({ email: 'a@example.invalid', password: 'synthetic-only' }))
    await cycleA.waitForFunction(() => document.querySelector('#identity')?.textContent?.endsWith('0001'))
    const cycleResult = await cycleA.evaluate(() => ({ current: oldContinuation(), cachedA: probeClient.getQueryData(['account', 'a']) ?? null, guest: ['ticket-collection', 'ticket-email-access', 'refund-details'].map(scope => probeClient.getQueryData([scope, 'guest'])) }))
    rows.push({ scenario: 'A to B to A invalidates late private continuation and preserves guest grants', ...cycleResult })
    assert.equal(cycleResult.current, false)
    assert.equal(cycleResult.cachedA, null)
    assert.deepEqual(cycleResult.guest, ['guest grant', 'guest grant', 'guest grant'])
    const delayedCallback = await page({ callback: true, holdZeroTimers: true })
    await delayedCallback.evaluate(() => AppAuth.supabase.auth.initialize())
    await cycleA.evaluate(() => AppAuth.signInOrganizer({ email: 'a@example.invalid', password: 'synthetic-only' }))
    await delayedCallback.waitForFunction(() => document.querySelector('#identity')?.textContent?.endsWith('0001'))
    await delayedCallback.evaluate(() => { probeClient.setQueryData(['account', 'a'], 'current A'); heldTimers.splice(0).forEach(run => run()) })
    await delayedCallback.waitForFunction(() => auditEvents.filter(item => item.event === 'SIGNED_IN' && item.user.endsWith('0002')).length > 0)
    await delayedCallback.waitForTimeout(100)
    const staleResult = await delayedCallback.evaluate(() => ({ user: document.querySelector('#identity')?.textContent, cache: probeClient.getQueryData(['account', 'a']) }))
    rows.push({ scenario: 'late startup callback cannot replace current UI identity or evict its cache', ...staleResult })
    assert.equal(staleResult.user, '00000000-0000-4000-8000-000000000001')
    assert.equal(staleResult.cache, 'current A')
    await delayedCallback.close(); await cycleA.close(); await cycleB.close()
    for (const unavailable of [{ noLocks: true }, { noBroadcastChannel: true }]) {
    const unsupported = await page(unavailable)
    const unsupportedResult = await unsupported.evaluate(async () => {
      try { await AppAuth.signInOrganizer({ email: 'a@example.invalid', password: 'synthetic-only' }); return { blocked: false } }
      catch (error) { return { blocked: true, message: error.message, calls: auditCalls } }
    })
    rows.push({ scenario: 'unavailable native coordination', unavailable, ...unsupportedResult })
    assert.equal(unsupportedResult.blocked, true)
    assert.match(unsupportedResult.message, /browser|coordination/i)
    assert.deepEqual(unsupportedResult.calls, [])
    await unsupported.getByRole('alert').filter({hasText:'Organizer authentication is unavailable'}).waitFor()
    rows.push({scenario:'explicit Auth-unavailable UI', unavailable, visible:true})
    await unsupported.close()
    }
    assert.equal(unexpected, 0)
    assert.deepEqual(pageErrors, [])
    console.log(JSON.stringify({ passed: true, browser: browser.version(), unexpected, pageErrors, rows }, null, 2))
  } catch (error) {
    console.log(JSON.stringify({ passed: false, browser: browser.version(), unexpected, pageErrors, rows, failure: error.message }, null, 2))
    process.exitCode = 1
  } finally {
    fs.mkdirSync(path.join(root, '.superpowers/spec14/auth'), { recursive: true })
    await context.close()
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
