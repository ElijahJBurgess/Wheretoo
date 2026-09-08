/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewApp } from './PreviewApp'
import { previewSections } from './catalog'
import snapshots from './screens.json'

const slugs = [...new Set(previewSections.flatMap((section) => section.screens.flatMap((entry) => entry.slug ? [entry.slug] : [])))]
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('development screen hub', () => {
  it('lists every requested section and distinguishes missing screens and runtime dependencies', () => {
    window.history.replaceState({}, '', '/preview')
    render(<PreviewApp />)
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4)
    expect(screen.getAllByText('Preview not available')).toHaveLength(5)
    expect(screen.getByText('Runtime data required')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(20)
    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).toMatch(/^\/preview\//)
  })

  it.each(slugs)('opens %s directly with no service calls and a route back to the hub', (slug) => {
    const fetch = vi.fn(() => { throw new Error('Preview must stay offline') })
    vi.stubGlobal('fetch', fetch)
    window.history.replaceState({}, '', `/preview/${slug}`)
    const view = render(<PreviewApp />)
    expect(view.container.querySelector('h1')).not.toBeNull()
    expect(screen.queryByText('Screen not found')).not.toBeInTheDocument()
    const snapshot = view.container.querySelector('[inert]')
    if (Object.hasOwn(snapshots, slug)) {
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
    expect(config.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }])
  })
})
