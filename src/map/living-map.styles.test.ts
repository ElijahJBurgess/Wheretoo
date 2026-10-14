import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/map/living-map.css', 'utf8')

it('scopes every preview/chooser selector, including mobile rules, to the map', () => {
  // Lazy route CSS survives navigation; organizer preview uses event-preview too.
  const selectors = css.split('\n').filter((line) => /\.event-(preview|chooser)/.test(line))
  expect(selectors.length).toBeGreaterThan(30)
  for (const selector of selectors) {
    expect(selector.trim()).toMatch(/^\.living-map(?:\.living-map--embedded)? \.event-(preview|chooser)/)
  }
})
