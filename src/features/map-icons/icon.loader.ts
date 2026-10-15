import { resolveMapIcons } from './icon.api'

export async function fetchMapIconDescriptors(ids: readonly string[]) {
  if (!ids.length) return []
  const origin = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!origin || !key) return []
  // Anonymous public contract: do not initialize session persistence or require
  // unrelated payment configuration merely to resolve approved map artwork.
  return resolveMapIcons(ids, async (name, args) => {
    const response = await fetch(`${origin}/rest/v1/rpc/${name}`, {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
    })
    return { data: response.ok ? await response.json() : null, error: response.ok ? null : response.status }
  }, origin)
}
