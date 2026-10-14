import type { Session, User } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react'
import { supabase } from '../../lib/supabase/client'
import { evictPrivateIdentityQueries } from './privateQueryCache'

export type SessionState =
  | { status: 'loading'; session: null; user: null }
  | { status: 'error'; session: null; user: null; retry: () => void }
  | { status: 'anonymous'; session: null; user: null }
  | { status: 'authenticated'; session: Session; user: User }

const loadingState: SessionState = { status: 'loading', session: null, user: null }
const anonymousState: SessionState = { status: 'anonymous', session: null, user: null }
const SessionContext = createContext<SessionState | undefined>(undefined)

function stateFromSession(session: Session | null): SessionState {
  return session === null
    ? anonymousState
    : { status: 'authenticated', session, user: session.user }
}

type SessionProviderProps = PropsWithChildren<{ queryClient?: QueryClient }>

export function SessionProvider({ children, queryClient }: SessionProviderProps) {
  const [state, setState] = useState<SessionState>(loadingState)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let authEventReceived = false
    let activeUserId: string | null = null
    const retry = () => {
      setState(loadingState)
      setAttempt((previous) => previous + 1)
    }
    const failSession = () => {
      window.clearTimeout(timeout)
      if (active && !authEventReceived) {
        setState({ status: 'error', session: null, user: null, retry })
      }
    }
    const timeout = window.setTimeout(failSession, 10_000)
    const applySession = (session: Session | null) => {
      if (!active) return
      window.clearTimeout(timeout)
      const nextUserId = session?.user.id ?? null
      if (nextUserId !== activeUserId) {
        if (queryClient) evictPrivateIdentityQueries(queryClient)
        activeUserId = nextUserId
      }
      setState(stateFromSession(session))
    }
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true
      applySession(session)
    })

    void supabase.auth
      .getSession()
      .then(({ data: sessionData, error }) => {
        if (active && !authEventReceived) {
          if (error) failSession()
          else applySession(sessionData.session)
        }
      })
      .catch(failSession)

    return () => {
      active = false
      window.clearTimeout(timeout)
      data.subscription.unsubscribe()
    }
  }, [attempt, queryClient])

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
}

// Context hooks intentionally live beside their provider so the state contract stays local.
// eslint-disable-next-line react-refresh/only-export-components
export function useSession(): SessionState {
  const state = useContext(SessionContext)

  if (state === undefined) {
    throw new Error('useSession must be used within SessionProvider')
  }

  return state
}
