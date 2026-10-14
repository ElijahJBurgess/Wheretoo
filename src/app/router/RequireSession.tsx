import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { useSession } from '../../features/auth/SessionProvider'

export function RequireSession() {
  const sessionState = useSession()
  const location = useLocation()

  switch (sessionState.status) {
    case 'loading':
      return <AsyncState status="loading" title="Checking your session" />
    case 'error':
      return <AsyncState
        action={<Button onClick={sessionState.retry}>Try again</Button>}
        description="Check your connection, then try again."
        status="error"
        title="Your session could not load"
      />
    case 'anonymous':
      return <Navigate replace state={{ from: location }} to="/auth/sign-in" />
    case 'authenticated':
      return <Outlet />
  }
}
