#!/usr/bin/env node
/* Actual production-app captures; no preview fixtures or user browser profile. */
process.umask(0o077)
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
require('tsx/cjs')
const { chromium } = require('@playwright/test')
const { providerBoundaries, origin } = require('./support/spec14Harness.ts')
const root = path.resolve(__dirname, '../..')
const state = path.join(root, '.superpowers/spec14')
const widths = [320, 390, 430, 768, 1440]
const hash = value => crypto.createHash('sha256').update(value).digest('hex')

function verificationSourceHashes(...runners) {
  return Object.fromEntries([...new Set(['tests/e2e/spec14-visual.cjs', 'tests/e2e/support/spec14Harness.ts', 'tests/e2e/spec14-reporter.ts', ...runners])].map(name => [name, hash(fs.readFileSync(path.join(root, name)))]))
}

function verifyIdentity(actual, expected, build) {
  if (actual.task !== 'spec14-final-assembly' || actual.task !== expected.task || actual.instanceId !== expected.instanceId || expected.root !== root || actual.application !== origin || actual.providers !== 'local simulation only' || actual.sourceSha256 !== build.sourceSha256 || actual.assetsSha256 !== build.assetsSha256 || actual.indexSha256 !== build.files?.['index.html']?.sha256) throw new Error('Visual target differs from recorded task build')
  return actual
}
async function verifiedIdentity() {
  const expected = JSON.parse(fs.readFileSync(path.join(state, 'environment-identity.json'), 'utf8'))
  const build = JSON.parse(fs.readFileSync(path.join(state, 'build-identity.json'), 'utf8'))
  const response = await fetch(origin + '/__spec14/identity')
  if (!response.ok) throw new Error('Task build identity unavailable')
  return verifyIdentity(await response.json(), expected, build)
}
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

async function capture(page, out, label, textScale) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => {
    await document.fonts.ready
    const urls = new Set([...document.querySelectorAll('body *')].flatMap(node => [...getComputedStyle(node).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(match => match[1])))
    await Promise.all([...urls].map(url => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = resolve; image.onerror = reject; image.src = url
      if (image.complete && image.naturalWidth) resolve()
    })))
  })
  await paint(page)
  const originalHeadingSize = await page.locator('h1').evaluate(node => parseFloat(getComputedStyle(node).fontSize))
  try {
  if (textScale === 2) {
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('body *')]
      const sizes = nodes.map(node => [node, parseFloat(getComputedStyle(node).fontSize)])
      for (const [node, size] of sizes) { node.dataset.spec14OriginalFontStyle = node.style.fontSize; node.style.fontSize = `${size * 2}px` }
    })
  }
  await paint(page)
  const geometry = await page.evaluate(() => {
    const root = document.documentElement
    const body = getComputedStyle(document.body)
    const heading = document.querySelector('h1')
    const h = heading && getComputedStyle(heading)
    const brand = document.querySelector('.operations-brand'), sidebar = document.querySelector('.operations-sidebar')
    let sidebarBrandOverflow = 0
    if (brand && sidebar) { const range = document.createRange(); range.selectNodeContents(brand); sidebarBrandOverflow = Math.max(0, range.getBoundingClientRect().right - sidebar.getBoundingClientRect().right) }
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, visualWidth: visualViewport?.width },
      viewportMeta: document.querySelector('meta[name=viewport]')?.content,
      sidebarBrandOverflow,
      discoveryFirstWordLines: (() => {
        const node = document.querySelector('.discovery-intro h1')?.firstChild
        if (!node || node.nodeType !== Node.TEXT_NODE) return []
        const word = node.textContent.split(/\s/)[0]
        return [...new Set([...word].map((_, index) => {
          const range = document.createRange()
          range.setStart(node, index); range.setEnd(node, index + 1)
          return Math.round(range.getBoundingClientRect().top)
        }))]
      })(),
      narrowEventCopy: innerWidth <= 760 ? [...document.querySelectorAll('.operations-layout .event-list__item a:not(.ops-event-row)')].flatMap(link => {
        const title = link.querySelector(':scope > strong')
        if (!title) return []
        const style = getComputedStyle(link)
        const contentWidth = link.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        const titleWidth = title.getBoundingClientRect().width
        return titleWidth < contentWidth * 0.75 ? [{ contentWidth, titleWidth }] : []
      }) : [],
      contentOverflows: [...document.querySelectorAll('.buyer-event-hero__copy, .buyer-wallet-row, .event-list__item a, .find-guest__results a, .public-ticket-tier')].flatMap(parent => {
        const boundary = parent.getBoundingClientRect()
        return [...parent.children].flatMap(child => {
          const rect = child.getBoundingClientRect()
          if (!rect.width || !rect.height) return []
          const excess = Math.max(0, boundary.left - rect.left, rect.right - boundary.right)
          return excess > 1 ? [{ parent: parent.className, child: child.tagName, excess }] : []
        })
      }),
      scrollWidth: root.scrollWidth, clientWidth: root.clientWidth,
      bodyFont: { family: body.fontFamily, size: body.fontSize, lineHeight: body.lineHeight },
      headingFont: h && { family: h.fontFamily, size: h.fontSize, lineHeight: h.lineHeight },
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      images: [...document.images].filter(img => img.getBoundingClientRect().width > 0).map(img => ({ complete: img.complete, naturalWidth: img.naturalWidth })),
    }
  })
  const screenshot = `${label}-${geometry.viewport.width}-text${textScale}.png`
  await page.screenshot({ path: path.join(out, screenshot), fullPage: true, animations: 'disabled' })
  fs.chmodSync(path.join(out, screenshot), 0o600)
  const observedHeadingSize = await page.locator('h1').evaluate(node => parseFloat(getComputedStyle(node).fontSize))
  if (Math.abs(observedHeadingSize - originalHeadingSize * textScale) > 0.01) throw new Error('Text resize was lost before capture; reject this evidence: ' + JSON.stringify({ originalHeadingSize, observedHeadingSize, textScale }))
  const navigationClearance = await page.evaluate(() => {
    const home = document.querySelector('.check-in-home')
    const nav = document.querySelector('.operations-sidebar nav')
    if (!home || !nav || getComputedStyle(nav).position !== 'fixed') return []
    scrollTo(0, document.documentElement.scrollHeight)
    const n = nav.getBoundingClientRect()
    return [...home.querySelectorAll(':scope > a.ops-button')].map(link => {
      const rect = link.getBoundingClientRect()
      return { bottom: rect.bottom, navTop: n.top, visibleAtDocumentEnd: rect.top >= 0 && rect.bottom <= innerHeight, overlapsNavigation: rect.right > n.left && rect.left < n.right && rect.bottom > n.top && rect.top < n.bottom }
    })
  })
  const focus = []
  for (let index = 0; index < 16; index++) {
    await page.keyboard.press('Tab')
    const row = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el)
      return { tag: el.tagName, role: el.getAttribute('role'), label: el.getAttribute('aria-label') || el.textContent || el.getAttribute('name'), width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom, visible: rect.width > 0 && rect.height > 0, outline: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow }
    })
    if (row) { row.labelHash = hash(String(row.label)); delete row.label; focus.push(row) }
  }
  return { label, routePath: new URL(page.url()).pathname, textScale, geometry, navigationClearance, screenshot, keyboardFocus: focus, observation: 'Pending actual image inspection; geometry is supporting evidence only' }
  } finally {
    if (textScale === 2) await page.evaluate(() => {
      for (const node of document.querySelectorAll('[data-spec14-original-font-style]')) {
        node.style.fontSize = node.dataset.spec14OriginalFontStyle; delete node.dataset.spec14OriginalFontStyle
      }
    })
    await page.evaluate(() => scrollTo(0, 0))
    await paint(page)
  }

}

async function main() {
  if (process.argv[2] !== 'anonymous') throw new Error('Specify anonymous; populated capture requires its explicit scenario state')
  const identity = await verifiedIdentity()
  const out = path.join(state, `visual-anonymous-${Date.now()}`)
  fs.mkdirSync(out, { mode: 0o700 })
  const browser = await chromium.launch({ args: ['--no-proxy-server', '--force-device-scale-factor=1'] })
  const results = []
  try {
    for (const width of widths) {
      for (const textScale of [1, 2]) {
        const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce', deviceScaleFactor: 1 })
        const blocked = await providerBoundaries(context, { allowProviderActions: false })
        const page = await context.newPage()
        for (const [label, route] of [['sign-in', '/auth/sign-in'], ['sign-up', '/auth/sign-up']]) {
          await page.goto(origin + route, { waitUntil: 'networkidle' })
          await page.getByRole('heading', { level: 1 }).waitFor()
          results.push(await capture(page, out, label, textScale))
        }
        if (blocked.length) throw new Error('Unexpected outbound request blocked during visual capture')
        await context.close()
      }
    }
  } finally { await browser.close() }
  const report = { scope: 'Anonymous organizer entry only; no signup mutation or principal journey', identity, browser: 'Playwright Chromium', textResize: 'All computed element font sizes doubled, including form controls for scale2; not a physical-browser UI zoom claim', results }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  const overflow = results.filter(row => row.geometry.scrollWidth > row.geometry.clientWidth).length
  console.log(JSON.stringify({ directory: path.relative(root, out), captures: results.length, horizontalOverflow: overflow, visualInspection: 'pending' }))
  if (overflow) process.exitCode = 1
}
module.exports = { capture, verifyIdentity, verifiedIdentity, verificationSourceHashes }
if (require.main === module) main().catch(() => { console.error('Visual capture failed; no private URL or provider payload printed.'); process.exitCode = 1 })
