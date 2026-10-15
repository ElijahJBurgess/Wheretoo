import { Component, lazy, Suspense, type ReactNode } from 'react'

const CityMap = lazy(() => import('../../map/LivingMapPage').then(module => ({ default: module.Component })))

// Map delivery must not take the event list or its navigation down with it.
class MapPreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed
      ? <p className="discovery-map-entry__loading" role="status">Map preview unavailable. Open the full map to try again.</p>
      : this.props.children
  }
}

export function DiscoveryMapPreview() {
  return <MapPreviewBoundary>
    <Suspense fallback={<p className="discovery-map-entry__loading" role="status">Loading the city map…</p>}>
      <CityMap embedded />
    </Suspense>
  </MapPreviewBoundary>
}
