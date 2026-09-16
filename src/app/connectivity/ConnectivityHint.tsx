import { useBrowserOnline } from './browserConnectivity'

export function ConnectivityHint() {
  const online = useBrowserOnline()
  return <div className="connectivity-hint" role="status" aria-live="polite">
    {!online && <p>Your browser may be offline. Some information may be out of date. Check your connection.</p>}
  </div>
}
