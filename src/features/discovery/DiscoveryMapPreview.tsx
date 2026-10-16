import type { DiscoveryMapProps } from '../../map/LivingMapPage'
import { MapStartupOverlay, MapStartupFallback } from '../../map/MapStartupOverlay'
import { Component, lazy, Suspense, type ReactNode } from 'react'

const CityMap = lazy(() => import('../../map/LivingMapPage').then(module => ({ default: module.Component })))

// Map delivery must not take the event list or its navigation down with it.
class MapPreviewBoundary extends Component<{ children: ReactNode; onUnavailable?(): void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() { this.props.onUnavailable?.() }

  render() {
    return this.state.failed
      ? <div className="discovery-map-entry__startup"><MapStartupOverlay state="error" onRetry={() => window.location.reload()} /></div>
      : this.props.children
  }
}

export function DiscoveryMapPreview(props: Omit<DiscoveryMapProps, 'embedded'> = {}) {
  return <MapPreviewBoundary onUnavailable={props.onUnavailable}>
    <Suspense fallback={<div className="discovery-map-entry__startup"><MapStartupFallback /></div>}>
      <CityMap {...props} embedded />
    </Suspense>
  </MapPreviewBoundary>
}
