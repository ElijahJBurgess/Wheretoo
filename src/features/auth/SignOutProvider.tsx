import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react'
import type { SignOutIdentity } from './authTransitions'
import { captureIdentityGeneration, captureSignOutLifetime } from './identityLifetime'
import { evictPrivateIdentityQueries } from './privateQueryCache'
import { reconcileAnonymousSession } from './sessionReconciliation'

export type SignOutResult = { localSignedOut: boolean; remoteRevoked: boolean; isCurrent: () => boolean }
type SignOutController = {
  pending: boolean
  notice: string | null
  error: string | null
  signOut: (expected: SignOutIdentity) => Promise<SignOutResult>
  dismissNotice: () => void
}
const SignOutContext = createContext<SignOutController | null>(null)

export function SignOutProvider({ children }: PropsWithChildren) {
  const client = useQueryClient()
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const latch = useRef<Promise<SignOutResult> | null>(null)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dismissNotice = useCallback(() => setNotice(null), [])
  const signOut = useCallback((expected: SignOutIdentity): Promise<SignOutResult> => {
    if (latch.current) return latch.current
    const identity = { user: { id: expected.user.id }, access_token: expected.access_token, refresh_token: expected.refresh_token }
    setPending(true)
    setError(null)
    setNotice(null)
    evictPrivateIdentityQueries(client)
    const dispatchCurrent = captureIdentityGeneration(client)
    const signOutLifetime = captureSignOutLifetime(client)
    const operation = (async () => {
      // Keep guest ticket/refund routes free of eager Auth initialization.
      const loaded = await import('./auth.api').catch(() => null)
      let remoteRevoked = false
      let localSignedOut = false
      let sessionChanged = false
      try {
        if (loaded) ({ localSignedOut, remoteRevoked, sessionChanged } = await loaded.signOut(identity, dispatchCurrent))
      } catch { /* A failed operation is never evidence of local removal. */ }
      const completionCurrent = localSignedOut && !sessionChanged && signOutLifetime()
        ? await reconcileAnonymousSession(client).catch(() => null) : null
      const isCurrent = () => mounted.current && !sessionChanged && signOutLifetime() && Boolean(completionCurrent?.())
      if (sessionChanged && mounted.current) {
        setError('Your organizer session changed. Nothing was signed out. Review the current account and try again.')
      } else if (localSignedOut && isCurrent()) {
        setNotice(remoteRevoked ? 'You have signed out.' : 'You have signed out on this device. We could not confirm sign-out of other sessions. Try again later from a signed-in session.')
      } else if (!localSignedOut && mounted.current && dispatchCurrent()) {
        setError('We could not sign out on this device. Please try again.')
      }
      return { localSignedOut, remoteRevoked, isCurrent }
    })()
    latch.current = operation
    void operation.finally(() => { latch.current = null; if (mounted.current) setPending(false) })
    return operation
  }, [client])
  return <SignOutContext.Provider value={{ pending, notice, error, signOut, dismissNotice }}>{children}</SignOutContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalSignOut(): SignOutController | null { return useContext(SignOutContext) }
// eslint-disable-next-line react-refresh/only-export-components
export function useSignOut(): SignOutController {
  const value = useOptionalSignOut()
  if (!value) throw new Error('useSignOut must be used within SignOutProvider')
  return value
}
