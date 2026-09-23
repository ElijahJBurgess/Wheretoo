/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewApp } from './PreviewApp'
import { previewSections } from './catalog'
import snapshots from './screens.json'
import { buyerScreens } from './buyerScreens'

vi.mock('qrcode.react', () => ({ QRCodeCanvas: () => <canvas aria-label="Admission QR code" /> }))

const slugs = [...new Set(previewSections.flatMap((section) => section.screens.flatMap((entry) => entry.slug ? [entry.slug] : [])))]
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('development screen hub', () => {
  it('lists every requested section and distinguishes missing screens and runtime dependencies', () => {
    window.history.replaceState({}, '', '/preview')
    render(<PreviewApp />)
    expect(screen.getByRole('heading', { name: 'Buyer Journey' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Shared states' })).toBeVisible()
    expect(screen.queryByText('Not built yet')).not.toBeInTheDocument()
    const previewLinks = screen.getAllByRole('link').map(link => link.getAttribute('href'))
    for (const buyer of buyerScreens) expect(previewLinks).toContain(`/preview/${buyer.slug}`)
    expect(screen.getByText('Runtime data required')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open live buyer flow' })).toHaveAttribute('href', '/events/8ad057c1-f7b1-4aec-90cb-260908000011')
    expect(previewLinks.filter(href => href?.startsWith('/preview/'))).toHaveLength(previewSections.flatMap(section => section.screens).filter(screen => screen.slug).length)
  })

  it.each(slugs)('opens %s directly with no service calls and a route back to the hub', (slug) => {
    const fetch = vi.fn(() => { throw new Error('Preview must stay offline') })
    vi.stubGlobal('fetch', fetch)
    window.history.replaceState({}, '', `/preview/${slug}`)
    const view = render(<PreviewApp />)
    expect(view.container.querySelector('h1')).not.toBeNull()
    expect(screen.queryByText('Screen not found')).not.toBeInTheDocument()
    const snapshot = view.container.querySelector('[inert]')
    if (Object.hasOwn(snapshots, slug) && !buyerScreens.some(buyer => buyer.slug === slug)) {
      expect(snapshot).not.toBeNull()
      expect(snapshot?.querySelector('[href], [action], [formaction], script, iframe, object, embed')).toBeNull()
    }
    fireEvent.click(screen.getByRole('link', { name: '← Screen hub' }))
    expect(screen.getByRole('heading', { name: 'Wheretoo screen hub' })).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('handles an unknown preview path without entering the production router', () => {
    window.history.replaceState({}, '', '/preview/missing')
    render(<PreviewApp />)
    expect(screen.getByRole('heading', { name: 'Screen not found' })).toBeInTheDocument()
  })

  it('ships the SPA fallback needed for direct Vercel routes', () => {
    const config = JSON.parse(readFileSync(`${process.cwd()}/vercel.json`, 'utf8'))
    expect(config.rewrites.at(-1)).toEqual({ source: '/(.*)', destination: '/index.html' })
    expect(config.rewrites[0].destination).toBe('/api/storefront?handle=:handle')
  })
})
