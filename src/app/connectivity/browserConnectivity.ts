import { useSyncExternalStore } from 'react'

function subscribe(notify: () => void) {
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)
  return () => {
    window.removeEventListener('online', notify)
    window.removeEventListener('offline', notify)
  }
}

// Browser connectivity is only a hint. Query adapters retain ownership of reconnect reads.
export function useBrowserOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
}
