import { describe, expect, it } from 'vitest'
import { resolveVisualScene } from './visualScenes'

describe('resolveVisualScene', () => {
  it('allows the deterministic SF proof scenes only on localhost', () => {
    expect(resolveVisualScene('?visualScene=sf-desktop', '127.0.0.1')).toMatchObject({
      center: [-122.4194, 37.7599], zoom: 14.6, pitch: 25, bearing: 0,
    })
    expect(resolveVisualScene('?visualScene=sf-mobile', 'localhost')).toMatchObject({
      center: [-122.4194, 37.7599], zoom: 14.8, pitch: 12, bearing: 0,
    })
    expect(resolveVisualScene('?visualScene=sf-desktop', 'example.com')).toBeNull()
    expect(resolveVisualScene('?visualScene=unknown', 'localhost')).toBeNull()
  })
})
