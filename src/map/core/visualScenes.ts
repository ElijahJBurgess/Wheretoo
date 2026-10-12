import type { MapCamera } from './map.types'

export type VisualScene = MapCamera & { viewport: { width: number; height: number } }

const visualScenes = {
  'sf-desktop': { viewport: { width: 1440, height: 900 }, center: [-122.4194, 37.7599], zoom: 14.6, pitch: 25, bearing: 0 },
  'sf-mobile': { viewport: { width: 390, height: 844 }, center: [-122.4194, 37.7599], zoom: 14.8, pitch: 12, bearing: 0 },
} satisfies Record<string, VisualScene>

export function resolveVisualScene(search: string, hostname: string): VisualScene | null {
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') return null
  const name = new URLSearchParams(search).get('visualScene')
  return name && name in visualScenes ? visualScenes[name as keyof typeof visualScenes] : null
}
