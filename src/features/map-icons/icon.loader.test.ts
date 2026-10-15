import { afterEach, expect, it, vi } from 'vitest'
import { fetchMapIconDescriptors } from './icon.loader'
import { flagDescriptor } from './icon.test-fixtures'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
it('resolves anonymous map icons without requiring unrelated Stripe or auth configuration', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:56321')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-local-key')
  vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', '')
  const fetch = vi.fn(async () => new Response(JSON.stringify({ catalogRevision: 1, renderingEnabled: true, versions: [flagDescriptor] })))
  vi.stubGlobal('fetch', fetch)
  const descriptors = await fetchMapIconDescriptors([flagDescriptor.versionId])
  expect(descriptors).toHaveLength(1)
  expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:56321/rest/v1/rpc/get_public_map_icon_versions', expect.objectContaining({ credentials: 'omit', redirect: 'error', cache: 'no-store' }))
})
