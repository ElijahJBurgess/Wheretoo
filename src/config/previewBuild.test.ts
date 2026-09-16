import { afterEach, describe, expect, it, vi } from 'vitest'
import configuration from '../../vite.config'

afterEach(() => vi.unstubAllEnvs())

async function galleryEnabled(mode: string) {
  vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_spec14synthetic')
  if (typeof configuration !== 'function') throw new Error('Expected Vite configuration factory')
  const result = await configuration({ command: 'build', mode })
  return result.define?.['import.meta.env.VITE_SCREEN_PREVIEW_ENABLED']
}

describe('explicit gallery build boundary', () => {
  it('keeps real Preview deployments free of the design gallery', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('WHERETOO_ENABLE_PREVIEW', '')
    expect(await galleryEnabled('production')).toBe('false')
  })

  it('requires opt-in for the local design gallery too', async () => {
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('WHERETOO_ENABLE_PREVIEW', '')
    expect(await galleryEnabled('development')).toBe('false')
    vi.stubEnv('WHERETOO_ENABLE_PREVIEW', '1')
    expect(await galleryEnabled('development')).toBe('true')
  })
})
