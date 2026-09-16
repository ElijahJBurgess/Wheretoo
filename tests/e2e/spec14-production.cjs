#!/usr/bin/env node
/* No business actions. Discovery reads update operational rate buckets.
 * One browser-only dropped startup chunk; provider actions are disabled. */
process.umask(0o077)
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
require('tsx/cjs')
const { chromium, expect: baseExpect } = require('@playwright/test')
const expect = baseExpect.configure({ timeout: 40_000 })
const { providerBoundaries, origin } = require('./support/spec14Harness.ts')
const { verifiedIdentity, verificationSourceHashes } = require('./spec14-visual.cjs')
const state = path.resolve(__dirname, '../../.superpowers/spec14')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

async function main() {
  const startedAt = new Date().toISOString()
  const runner = 'tests/e2e/spec14-production.cjs'
  const results = []
  let identity = null, build = null, browser = null, sourceHashes = null, failure = null
  let outcome = 'partial', stage = 'target-identity'
  const save = () => fs.writeFileSync(path.join(state, 'production-browser-result.json'), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), identity, sourceHashes, outcome, failure, results, scope: 'anonymous routes, gallery disabled, served bytes, browser-only startup failure; discovery consumes operational rate limits; no business actions or provider control binding; no deployment or principal journey claim' }, null, 2), { mode: 0o600 })
  save()
  try {
  sourceHashes = verificationSourceHashes(runner)
  identity = await verifiedIdentity()
  build = JSON.parse(fs.readFileSync(path.join(state, 'build-identity.json'), 'utf8'))
  stage = 'served-artifacts'
  for (const [name, expected] of Object.entries(build.files)) {
    if (expected.kind !== 'file') throw new Error('Unsupported served artifact kind')
    const response = await fetch(origin + '/' + name.split('/').map(encodeURIComponent).join('/'))
    if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== expected.sha256) throw new Error('Served artifact bytes differ from recorded build')
  }
  results.push({ check: 'complete served artifact bytes', files: Object.keys(build.files).length, outcome: 'passed' })
  const missing = await fetch(origin + '/assets/spec14-definitely-absent.js')
  if (missing.status !== 404) throw new Error('Absent asset did not return404')
  results.push({ check: 'missing static asset', status: missing.status, outcome: 'passed' })
  browser = await chromium.launch()
    for (const [route, heading, finalPath] of [
      ['/', 'Somewhere to go?', '/discover'],
      ['/discover', 'Somewhere to go?', '/discover'],
      ['/auth/sign-in', 'Sign in', '/auth/sign-in'],
      ['/auth/sign-up', 'Create your organizer account', '/auth/sign-up'],
      ['/organizer/events', 'Sign in', '/auth/sign-in'],
      ['/events/not-a-uuid', 'Event not found', '/events/not-a-uuid'],
      ['/preview', 'Page not found', '/preview'],
    ]) {
      stage = 'route:' + route
      const context = await browser.newContext()
      context.setDefaultTimeout(40_000)
      const blocked = await providerBoundaries(context, { allowProviderActions: false })
      const errors = []
      const loaded = new Set()
      const page = await context.newPage()
      page.on('pageerror', () => errors.push('pageerror'))
      page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/assets/')) loaded.add(new URL(response.url()).pathname) })
      try {
        await page.goto(origin + route, { waitUntil: 'networkidle' })
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
        await expect.poll(() => new URL(page.url()).pathname).toBe(finalPath)
        await page.reload({ waitUntil: 'networkidle' })
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
        if (blocked.length || errors.length) throw new Error('Unexpected route boundary or runtime error')
        if (route === '/preview' && [...loaded].some(name => /PreviewApp|galleryFixtures|screenCatalog/i.test(name))) throw new Error('Disabled preview loaded fixture code')
        results.push({ check: 'deep link and reload', route, finalPath, loadedAssets: loaded.size, outcome: 'passed' })
      } finally { await context.close() }
    }

    stage = 'dropped-startup-chunk'
    const startupChunk = Object.keys(build.files).find(name => /^assets\/App-[^/]+\.js$/.test(name))
    if (!startupChunk) throw new Error('Recorded startup chunk not found')
    const context = await browser.newContext()
    context.setDefaultTimeout(40_000)
    const blocked = await providerBoundaries(context, { allowProviderActions: false })
    let dropped = 0
    await context.route(origin + '/' + startupChunk, route => { dropped++; return route.abort('failed') })
    const page = await context.newPage()
    let pageErrors = 0
    page.on('pageerror', () => pageErrors++)
    try {
      await page.goto(origin + '/discover', { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Application unavailable', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Go to sign in', exact: true })).toHaveAttribute('href', '/auth/sign-in')
      if (dropped === 0) throw new Error('Startup failure control did not intercept a request')
      if (blocked.length || pageErrors) throw new Error('Unexpected startup failure boundary or uncaught error')
      results.push({ check: 'dropped startup chunk renders recovery', dropped, outcome: 'passed', boundary: 'browser-only asset response loss' })
    } finally { await context.close() }
    stage = 'verification-source-binding'
    if (JSON.stringify(verificationSourceHashes(runner)) !== JSON.stringify(sourceHashes)) throw new Error('Verification source changed during execution')
    outcome = 'passed'
  } catch (error) {
    failure = { name: error.name, stage }
    throw error
  } finally {
    await browser?.close()
    save()
  }
  console.log(JSON.stringify({ checks: results.length, artifacts: Object.keys(build.files).length, outcome: 'passed' }))
}
main().catch(() => { console.error('Production browser check failed; inspect the private result for completed checks.'); process.exitCode = 1 })
