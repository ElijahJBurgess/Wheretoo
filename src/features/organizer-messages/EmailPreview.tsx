import { publicEnv } from '../../lib/env'
import { z } from 'zod'
import { createElement, type ReactNode, useMemo } from 'react'
const allowed = new Set([
  'div',
  'p',
  'h1',
  'h2',
  'h3',
  'span',
  'strong',
  'b',
  'em',
  'br',
  'hr',
  'table',
  'tbody',
  'thead',
  'tr',
  'td',
  'th',
])
function renderNode(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (!(node instanceof Element)) return null
  const tag = node.tagName.toLowerCase()
  if (
    [
      'script',
      'style',
      'head',
      'iframe',
      'object',
      'svg',
      'form',
      'input',
      'button',
    ].includes(tag)
  ) return null
  // Email preheaders are hidden transport metadata, not visible template content.
  if (
    node.getAttribute('style')?.includes('display:none') ||
    node.getAttribute('style')?.includes('display: none')
  ) return null
  if (tag === 'img') {
    try {
      const url = new URL(node.getAttribute('src') ?? '')
      if (
        url.protocol !== 'https:' ||
        url.origin !== new URL(publicEnv.supabaseUrl).origin || url.username ||
        url.password || url.hash ||
        !['/functions/v1/event-images', '/functions/v1/organizer-media']
          .includes(url.pathname) ||
        Array.from(url.searchParams.keys()).join(',') !== 'id' ||
        !z.uuid().safeParse(url.searchParams.get('id')).success
      ) return null
      return (
        <img key={key} src={url.href} alt={node.getAttribute('alt') ?? ''} />
      )
    } catch {
      return null
    }
  }
  const children = Array.from(node.childNodes).map(renderNode)
  // Link destinations are deliberately inert; no server HTML/attributes execute.
  return createElement(allowed.has(tag) ? tag : 'div', { key }, ...children)
}
export function EmailPreview({ html }: { html: string }) {
  const content = useMemo(
    () =>
      Array.from(
        new DOMParser().parseFromString(html, 'text/html').body.childNodes,
      ).map(renderNode),
    [html],
  )
  return (
    <div
      className='organizer-email-template'
      aria-label='Email content preview'
    >
      {content}
    </div>
  )
}
