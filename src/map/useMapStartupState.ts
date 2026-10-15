import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { MapStartupState } from './MapStartupOverlay'

export function useMapStartupState(attempt = 0): [MapStartupState, Dispatch<SetStateAction<MapStartupState>>] {
  const [state, setState] = useState<MapStartupState>('loading')
  useEffect(() => {
    if (state !== 'loading') return
    const timer = window.setTimeout(() => setState(current => current === 'loading' ? 'slow' : current), 15000)
    return () => window.clearTimeout(timer)
  }, [state, attempt])
  return [state, setState]
}
