import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')

describe('organizer mobile navigation styles', () => {
  it('wraps the organizer navigation to a contained second row at 320px and 375px', () => {
    expect(css).toMatch(/\.organizer-layout__header\s*\{[^}]*flex-wrap:\s*wrap;/)
    expect(css).toMatch(/@media \(max-width: 35\.99rem\)[\s\S]*\.organizer-layout__header\s*\{[^}]*align-items:\s*flex-start;[^}]*\}/)
    expect(css).toMatch(/@media \(max-width: 35\.99rem\)[\s\S]*\.organizer-layout__header nav\s*\{[^}]*width:\s*100%;[^}]*\}/)
    expect(css).toMatch(/@media \(max-width: 35\.99rem\)[\s\S]*\.organizer-layout__nav\s*\{[^}]*justify-content:\s*space-between;[^}]*\}/)
    expect(css).toMatch(/@media \(max-width: 35\.99rem\)[\s\S]*\.organizer-layout__nav :is\(a, \.organizer-layout__sign-out\)\s*\{[^}]*min-height:\s*2\.75rem;[^}]*\}/)
  })
})
