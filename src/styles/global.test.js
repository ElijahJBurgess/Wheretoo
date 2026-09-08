import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')

describe('organizer mobile navigation styles', () => {
  it('wraps the organizer navigation to a contained second row at 320px and 375px', () => {
    expect(css).toMatch(/\.organizer-layout__header\s*\{[^}]*flex-wrap:\s*wrap;/)
    expect(css).toMatch(/@media \(max-width: 35\.99rem\)[\s\S]*\.organizer-layout__header\s*\{[^}]*align-items:\s*flex-start;[^}]*\}/)
    expect(css).toMatch(/@media \(max-width: 35\.99rem\)[\s\S]*\.organizer-layout__header nav\s*\{[^}]*width:\s*100%;[^}]*\}/)
    expect(css).toMatch(/@media \(max-width: 35\.99rem\)[\s\S]*\.organizer-layout__nav\s*\{[^}]*justify-content:\s*flex-start;[^}]*\}/)
    expect(css).toMatch(/@media \(max-width: 35\.99rem\)[\s\S]*\.organizer-layout__nav :is\(a, \.organizer-layout__sign-out\)\s*\{[^}]*min-height:\s*2\.75rem;[^}]*\}/)
  })
})

describe('ticket experience shell styles', () => {
  it('keeps ticket controls touch-safe and the QR stable across responsive layouts', () => {
    expect(css).toMatch(/\.ticket-page\s*\{[^}]*min-height:\s*100(?:d)?vh;[^}]*padding:[^;}]*env\(safe-area-inset-top\)[^;}]*;/)
    expect(css).toMatch(/\.ticket-qr\s*\{[^}]*width:\s*min\(100%,\s*16\.125rem\);[^}]*aspect-ratio:\s*1;/)
    expect(css).toMatch(/\.focused-ticket__navigation button\s*\{[^}]*min-height:\s*2\.75rem;/)
    expect(css).toMatch(/\.ticket-card__copy\s*\{[^}]*min-width:\s*0;/)
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.ticket-page/)
  })

  it('uses distinct text-supported treatments for every customer ticket state', () => {
    for (const state of ['valid', 'used', 'refunded', 'cancelled', 'ended', 'unavailable']) {
      expect(css).toContain(`.ticket-status--${state}`)
    }
  })
})
