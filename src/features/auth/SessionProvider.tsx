import type { Session, User } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react'
import { supabase } from '../../lib/supabase/client'
import { evictPrivateIdentityQueries } from './privateQueryCache'

export type SessionState =
  | { status: 'loading'; session: null; user: null }
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

  useEffect(() => {
    let active = true
    let authEventReceived = false
    let activeUserId: string | null = null
    const applySession = (session: Session | null) => {
      const nextUserId = session?.user.id ?? null
      if (nextUserId !== activeUserId) {
        if (queryClient) evictPrivateIdentityQueries(queryClient)
        activeUserId = nextUserId
      }
      if (active) setState(stateFromSession(session))
    }
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true
      applySession(session)
    })

    void supabase.auth
      .getSession()
      .then(({ data: sessionData }) => {
        if (active && !authEventReceived) {
          applySession(sessionData.session)
        }
      })
      .catch(() => {
        if (active && !authEventReceived) {
          applySession(null)
        }
      })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [queryClient])

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
