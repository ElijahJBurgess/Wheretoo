import { describe, expect, it } from 'vitest'
import { withMapIconOrigin } from './mapIconCsp'

const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; img-src \'self\' blob:; connect-src \'self\' https://api.mapbox.com; script-src \'self\'" />'
describe('configured icon delivery CSP', () => {
  it.each(['http://127.0.0.1:56321', 'https://project.supabase.co'])('adds only the exact validated origin %s', origin => {
    const result = withMapIconOrigin(html, origin)
    expect(result).toContain(`img-src 'self' blob: ${origin}`)
    expect(result).toContain(`connect-src 'self' https://api.mapbox.com ${origin}`)
    expect(result).toContain("script-src 'self'")
    expect(withMapIconOrigin(result, origin)).toBe(result)
  })
  it.each(['javascript:alert(1)', 'http://external.example', 'https://user:password@project.supabase.co', 'https://project.supabase.co/path', 'https://project.supabase.co?x=1'])('rejects unsafe origin %s', origin => {
    expect(() => withMapIconOrigin(html, origin)).toThrow()
  })
  it('leaves unconfigured builds unchanged', () => expect(withMapIconOrigin(html, undefined)).toBe(html))
})
