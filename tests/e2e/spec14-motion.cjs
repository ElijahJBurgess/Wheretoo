#!/usr/bin/env node
/* Observe real discovery loading motion while delaying only its read request. */
process.umask(0o077)
const fs = require('node:fs')
const path = require('node:path')
require('tsx/cjs')
const { chromium, expect: baseExpect } = require('@playwright/test')
const expect = baseExpect.configure({ timeout: 40_000 })
const { providerBoundaries, origin } = require('./support/spec14Harness.ts')
const { verifiedIdentity, verificationSourceHashes } = require('./spec14-visual.cjs')

async function main() {
  const startedAt = new Date().toISOString()
  const runner = 'tests/e2e/spec14-motion.cjs'
  const sourceHashes = verificationSourceHashes(runner)
  const identity = await verifiedIdentity()
  const out = path.resolve(__dirname, '../../.superpowers/spec14/visual-motion-' + Date.now())
  fs.mkdirSync(out, { mode: 0o700 })
  const results = []
  const browser = await chromium.launch()
  let outcome = 'partial'
  let stage = 'setup'
  let failure = null
  try {
    for (const preference of ['no-preference', 'reduce']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 960 }, reducedMotion: preference })
      context.setDefaultTimeout(40_000)
      const blocked = await providerBoundaries(context, { allowProviderActions: false })
      let release
      const gate = new Promise(resolve => { release = resolve })
      let held = 0
      await context.route('**/functions/v1/public-discovery', async route => { held++; await gate; await route.continue() })
      const page = await context.newPage()
      let pageErrors = 0
      page.on('pageerror', () => pageErrors++)
      try {
        stage = preference + ':loading'
        await page.goto(origin + '/discover', { waitUntil: 'domcontentloaded' })
        await expect(page.locator('.discovery-skeletons i').first()).toBeVisible()
        const motion = await page.locator('.discovery-skeletons i').evaluateAll(nodes => nodes.map(node => ({ name: getComputedStyle(node).animationName, duration: getComputedStyle(node).animationDuration })))
        const active = motion.filter(row => row.name !== 'none' && row.duration !== '0s').length
        if (!held || (preference === 'reduce' ? active !== 0 : active === 0)) throw new Error('Motion preference did not produce expected real loading state')
        const screenshot = preference + '-390-loading.png'
        await page.screenshot({ path: path.join(out, screenshot), fullPage: true })
        stage = preference + ':read-resumption'
        release()
        await expect(page.locator('.discovery-skeletons')).toHaveCount(0)
        await expect(page.getByRole('heading', { name: 'Somewhere to go?', exact: true })).toBeVisible()
        if (blocked.length || pageErrors) throw new Error('Unexpected outbound request or runtime error')
        results.push({ preference, heldReadRequests: held, activeSkeletonAnimations: active, skeletons: motion.length, readyAfterRelease: true, screenshot })
      } finally { release(); await context.close() }
    }
    stage = 'verification-source-binding'
    if (JSON.stringify(verificationSourceHashes(runner)) !== JSON.stringify(sourceHashes)) throw new Error('Verification source changed during execution')
    outcome = 'passed'
  } catch (error) {
    failure = { name: error.name, stage }
    throw error
  } finally {
    await browser.close()
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), sourceHashes, identity, outcome, failure, results, scope: '390px actual discovery loading and ready states; read request delay only; operational discovery rate buckets consumed; no business actions or provider control binding; image inspection pending' }, null, 2), { mode: 0o600 })
  }
  console.log(JSON.stringify({ directory: path.basename(out), cases: results.length, outcome }))
}
main().catch(() => { console.error('Motion check failed; private evidence retained.'); process.exitCode = 1 })
