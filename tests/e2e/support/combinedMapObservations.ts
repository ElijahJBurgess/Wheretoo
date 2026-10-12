import { execFileSync } from 'node:child_process'
import { expect, type Page, type TestInfo } from '@playwright/test'
import type { Map as MapboxMap } from 'mapbox-gl/esm'
// Mapbox's bundled feature type references an unbundled GeoJSON namespace.
// Describe only the point-feature fields this read-only harness observes.
type ProofMap = Omit<MapboxMap, 'queryRenderedFeatures'> & {
  queryRenderedFeatures(options: { layers: string[] }): Array<{
    properties?: Record<string, unknown>
    geometry: { type: string; coordinates: number[] }
  }>
}
declare global { interface Window { __phase4Map: ProofMap } }

export async function shot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready)
  await expect.poll(() => page.locator('img').evaluateAll(images => images.filter(image => {
    const box = image.getBoundingClientRect()
    return image.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && box.width > 0 && box.height > 0
      && box.top < innerHeight && box.bottom > 0 && box.left < innerWidth && box.right > 0
  }).filter(image => !(image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))
    .map(image => ({ className: image.className, width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height }))), { timeout: 15000 }).toEqual([])
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: false })
  await info.attach(name, { path, contentType: 'image/png' })
  console.info('Captured proof:', name)
}

export async function mapReference(page: Page) {
  await expect(page.locator('main')).toHaveAttribute('data-renderer-state', 'ready', { timeout: 60000 })
  await page.evaluate(() => {
    // Read-only test instrumentation: no production debug globals or map instance.
    type Hook = { memoizedState?: { current?: unknown }; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    const node = document.querySelector('.living-map__canvas') as unknown as Record<string, unknown>
    let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber'))!] as Fiber | undefined
    while (fiber) {
      let hook = fiber.memoizedState
      while (hook) {
        const value = hook.memoizedState?.current as ProofMap | undefined
        if (value && typeof value.getSource === 'function' && typeof value.project === 'function') { window.__phase4Map = value; return }
        hook = hook.next
      }
      fiber = fiber.return
    }
    throw new Error('Existing map reference unavailable')
  })
}

export async function iconReady(page: Page) {
  await page.waitForFunction(() => window.__phase4Map.loaded() && window.__phase4Map.getStyle().layers?.some(layer => layer.id.startsWith('wheretoo-icon-') && layer.id.endsWith('-canonical') && window.__phase4Map.getLayoutProperty(layer.id, 'visibility') === 'visible'), null, { timeout: 30000 })
}

export async function darkReady(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__phase4Map.loaded()), { timeout: 30000 }).toBe(true)
  expect(await page.evaluate(() => {
    const map = window.__phase4Map
    return ['lightPreset', 'theme', 'showPointOfInterestLabels', 'showPlaceLabels', 'showRoadLabels'].map(key => map.getConfigProperty('basemap', key))
  })).toEqual(['night', 'monochrome', true, true, true])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

export async function verifyArtworkLighting(page: Page, info: TestInfo, center: [number, number]) {
  const point = await page.evaluate(coordinate => { const p = window.__phase4Map.project(coordinate); return { x: p.x, y: p.y } }, center)
  const night = info.outputPath('flag-night-lighting.png'), day = info.outputPath('flag-day-lighting.png')
  await page.screenshot({ path: night })
  await page.evaluate(() => { window.__phase4Map.setConfigProperty('basemap', 'lightPreset', 'day') })
  await page.waitForFunction(() => window.__phase4Map.loaded())
  await page.screenshot({ path: day })
  const crop = `36x57+${Math.round(point.x)}+${Math.round(point.y) - 64}`
  const pixels = (path: string) => execFileSync('magick', [path, '-crop', crop, '-depth', '8', 'rgb:-'])
  const a = pixels(night), b = pixels(day)
  let count = 0, total = 0
  for (let i = 0; i < a.length; i += 3) {
    // Only opaque red/yellow artwork interiors, not antialiased map edges.
    if (a[i] > 180 && a[i] > a[i + 1] * 1.2 && a[i + 2] < 120 && b[i] > 180 && b[i] > b[i + 1] * 1.2 && b[i + 2] < 120) {
      count++; total += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
    }
  }
  expect(count).toBeGreaterThan(200)
  expect(total / (count * 3)).toBeLessThan(3)
  await info.attach('night-artwork-brightness', { body: JSON.stringify({ comparedPixels: count, meanChannelDifference: total / (count * 3) }), contentType: 'application/json' })
  await page.evaluate(() => { window.__phase4Map.setConfigProperty('basemap', 'lightPreset', 'night') })
  await darkReady(page)
}

export async function reloadSelectedStyle(page: Page, eventId: string) {
  const canvas = await page.locator('.mapboxgl-canvas').elementHandle()
  const camera = await page.evaluate(() => { const m = window.__phase4Map; return [m.getCenter().lng, m.getCenter().lat, m.getZoom(), m.getPitch(), m.getBearing()] })
  await page.evaluate(async () => {
    const map = window.__phase4Map, config = map.getConfig('basemap')
    if (!config) throw new Error('Standard config unavailable before reload')
    await new Promise<void>(resolve => {
      map.once('style.load', () => resolve())
      map.setStyle('mapbox://styles/mapbox/standard', { diff: false, config: { basemap: config }, localFontFamily: undefined, localIdeographFontFamily: 'sans-serif' })
    })
  })
  await selectedIconReady(page, eventId)
  await darkReady(page)
  expect(await canvas!.evaluate(node => node === document.querySelector('.mapboxgl-canvas'))).toBe(true)
  expect(await page.evaluate(() => { const m = window.__phase4Map; return [m.getCenter().lng, m.getCenter().lat, m.getZoom(), m.getPitch(), m.getBearing()] })).toEqual(camera)
  expect(await page.evaluate(id => {
    const m = window.__phase4Map
    const layers = m.getStyle().layers!.filter(l => l.id.startsWith('wheretoo-icon-') && l.id.endsWith('-canonical')).map(l => l.id)
    const source = m.getSource('wheretoo-selected-event') as unknown as { _data: { features: unknown[] } }
    return { canonical: m.queryRenderedFeatures({ layers }).filter(f => f.properties?.eventId === id).length, selected: source._data.features.length }
  }, eventId)).toEqual({ canonical: 0, selected: 1 })
}

export async function selectedIconReady(page: Page, eventId: string) {
  await page.waitForFunction(id => {
    const map = window.__phase4Map
    const layers = map.getStyle().layers?.filter(layer => layer.id.startsWith('wheretoo-icon-') && layer.id.endsWith('-selected')).map(layer => layer.id) ?? []
    return !map.isMoving() && layers.length > 0 && map.queryRenderedFeatures({ layers }).some(feature => feature.properties?.eventId === id)
  }, eventId)
}

export async function openTappedPreview(page: Page, title: string) {
  const preview = page.getByRole('region', { name: title, exact: true })
  const choice = page.getByRole('button', { name: `Open ${title} event preview`, exact: true })
  await expect(preview.or(choice)).toBeVisible()
  if (await choice.isVisible()) await choice.click()
  await expect(preview).toBeVisible()
}

export async function measureTip(page: Page, info: TestInfo, name: string, coordinate: [number, number]) {
  const point = await page.evaluate(center => { const p = window.__phase4Map.project(center); return { x: p.x, y: p.y } }, coordinate)
  const path = info.outputPath(`${name}-anchor.png`)
  await page.screenshot({ path })
  const left = Math.floor(point.x) - 6, top = Math.floor(point.y) - 5
  const pixels = execFileSync('magick', [path, '-crop', `13x10+${left}+${top}`, '-depth', '8', 'rgb:-'])
  const yellow: { x: number; y: number; weight: number }[] = []
  for (let y = 0; y < 10; y++) for (let x = 0; x < 13; x++) {
    const [r, g, b] = pixels.subarray((y * 13 + x) * 3, (y * 13 + x) * 3 + 3)
    if (r > 150 && g > 60 && r > g * 1.1 && b < 150) yellow.push({ x, y, weight: r - g })
  }
  expect(yellow.length).toBeGreaterThan(0)
  const last = Math.max(...yellow.map(pixel => pixel.y)), row = yellow.filter(pixel => pixel.y === last)
  const tip = { x: left + row.reduce((sum, p) => sum + (p.x + 0.5) * p.weight, 0) / row.reduce((sum, p) => sum + p.weight, 0), y: top + last + 1 }
  const delta = { x: Math.abs(tip.x - point.x), y: Math.abs(tip.y - point.y) }
  expect(delta.x).toBeLessThanOrEqual(1); expect(delta.y).toBeLessThanOrEqual(1)
  await info.attach(`${name}-anchor-measurement`, { body: JSON.stringify({ point, tip, delta }), contentType: 'application/json' })
}
