import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  isValidHandle,
  normalizeHandle,
} from '../src/features/storefront/storefront.handle.js'
import { storefrontDocumentSchema } from '../src/features/storefront/storefront.schemas.js'
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]!),
  )
export async function storefrontHtml(
  template: string,
  handle: string,
  config: { origin: string; supabaseUrl: string; publicKey: string },
  fetcher: typeof fetch = fetch,
): Promise<{ html: string; status: number }> {
  const normalized = normalizeHandle(handle)
  if (!isValidHandle(normalized)) return { html: template, status: 200 }
  try {
    const origin = new URL(config.origin)
    if (
      !['http:', 'https:'].includes(origin.protocol) || origin.username ||
      origin.password || origin.pathname !== '/' || origin.search || origin.hash
    ) throw new Error('Invalid canonical origin')
    const response = await fetcher(
      `${config.supabaseUrl}/rest/v1/rpc/get_public_organizer_storefront`,
      {
        method: 'POST',
        headers: {
          apikey: config.publicKey,
          authorization: `Bearer ${config.publicKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ p_handle: normalized, p_limit: 1 }),
        signal: AbortSignal.timeout(2500),
      },
    )
    if (!response.ok) throw new Error('Read unavailable')
    const value: unknown = await response.json()
    if (value === null) {
      return {
        html: template.replace(
          '</head>',
          '<meta name="robots" content="noindex" /></head>',
        ),
        status: 404,
      }
    }
    const data = storefrontDocumentSchema.parse(value)
    const identity = data.identity
    const title = `${identity.name} | Wheretoo`
    const description = identity.bio ||
      `Upcoming events from ${identity.name}${
        identity.city ? ` in ${identity.city}` : ''
      }.`
    const canonical = `${origin.origin}/${encodeURIComponent(normalized)}`
    const image = identity.coverId ?? identity.logoId
    const tags = [
      `<meta name="description" content="${escape(description)}" />`,
      `<link rel="canonical" href="${escape(canonical)}" />`,
      ...Object.entries({
        'og:type': 'website',
        'og:title': title,
        'og:description': description,
        'og:url': canonical,
        ...(image
          ? {
            'og:image':
              `${config.supabaseUrl}/functions/v1/organizer-media?id=${
                encodeURIComponent(image)
              }`,
          }
          : {}),
      }).map(([property, content]) =>
        `<meta property="${property}" content="${escape(content)}" />`
      ),
      '<meta name="twitter:card" content="summary_large_image" />',
    ]
    return {
      html: template.replace(
        /<title>[^<]*<\/title>/,
        `<title>${escape(title)}</title>`,
      ).replace('</head>', `${tags.join('\n')}\n</head>`),
      status: 200,
    }
  } catch {
    // Keep the SPA usable during metadata outages; do not cache a false not-found.
    return { html: template, status: 200 }
  }
}
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.setHeader('Cache-Control', 'private, no-store')
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405
    response.setHeader('Allow', 'GET, HEAD')
    response.end()
    return
  }
  try {
    const url = new URL(request.url ?? '/', 'http://internal.invalid')
    const handle = url.searchParams.get('handle') ?? url.pathname.slice(1)
    const template = await readFile(
      resolve(process.cwd(), 'dist/index.html'),
      'utf8',
    )
    const result = await storefrontHtml(template, handle, {
      origin: process.env.APP_BASE_URL ?? '',
      supabaseUrl: process.env.VITE_SUPABASE_URL ?? '',
      publicKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
    })
    response.statusCode = result.status
    response.end(request.method === 'HEAD' ? undefined : result.html)
  } catch {
    response.statusCode = 503
    response.end('Storefront temporarily unavailable.')
  }
}
