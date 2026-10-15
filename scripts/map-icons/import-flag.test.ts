// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { assertLocalIconTarget, verifyFlagBuffers } from './import-flag'

describe('curation importer safety', () => {
  it('accepts only the dedicated loopback API', () => {
    expect(() => assertLocalIconTarget('http://127.0.0.1:56321')).not.toThrow()
    expect(() => assertLocalIconTarget('http://127.0.0.1:64321')).not.toThrow()
  })
  it.each(['https://example.supabase.co', 'http://127.0.0.1:54321', 'http://localhost:56321',
    'http://127.0.0.1:56321@evil.test', 'http://127.0.0.1:56321/path', 'http://127.0.0.1:56321?x=1'])('refuses unsafe target %s before mutation', url => {
    expect(() => assertLocalIconTarget(url)).toThrow()
  })
  it('refuses changed original or runtime bytes before image decoding', () => {
    expect(() => verifyFlagBuffers(Buffer.from('not approved'), Buffer.from('not png'))).toThrow()
  })
})
