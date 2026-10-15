import { useMapStartupState } from './useMapStartupState'
import { useEffect, useState } from 'react'
import logo from './assets/wheretoo-white-w.png'
import './map-startup.css'

export type MapStartupState = 'loading' | 'slow' | 'error' | 'ready'
export function MapStartupFallback({ onRetry = () => window.location.reload() }: { onRetry?: () => void }) {
  const [state] = useMapStartupState()
  return <MapStartupOverlay state={state} onRetry={onRetry} />
}

export function MapStartupOverlay({ state, onRetry }: { state: MapStartupState; onRetry?: () => void }) {
  const [exited, setExited] = useState(state === 'ready')
  useEffect(() => {
    if (state !== 'ready') return
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const timer = window.setTimeout(() => setExited(true), reducedMotion ? 0 : 180)
    return () => window.clearTimeout(timer)
  }, [state])
  if (state === 'ready' && exited) return null
  const ready = state === 'ready'
  return <div className="map-startup" data-state={state} aria-hidden={ready || undefined} inert={ready || undefined}>
    <div className="map-startup__content" role={ready ? undefined : state === 'error' ? 'alert' : 'status'} aria-label={state === 'loading' ? 'Loading map' : undefined}>
      <img className="map-startup__logo" src={logo} width="512" height="302" alt="" aria-hidden="true" />
      {state === 'error' ? <><h2>We couldn’t load the map.</h2><p>Please try again.</p></>
        : state === 'slow' ? <p>The map is taking longer than expected.</p> : <p>Finding your next move.</p>}
      {(state === 'slow' || state === 'error') && onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}
    </div>
  </div>
}
