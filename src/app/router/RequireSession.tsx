import { z } from 'zod'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { useSession } from '../../features/auth/SessionProvider'

export function RequireSession() {
  const sessionState = useSession()
  const location = useLocation()

  const paymentIds = location.pathname === '/organizer/settings/payments' ? new URLSearchParams(location.search).getAll('eventId') : []
  const paymentEventId = paymentIds.length === 1 && z.uuid().safeParse(paymentIds[0]).success ? paymentIds[0] : undefined

  switch (sessionState.status) {
    case 'loading':
      return <AsyncState status="loading" title="Checking your session" />
    case 'unavailable':
      return <AsyncState status="error" title="Organizer authentication is unavailable" />
    case 'anonymous':
      return <Navigate replace state={{ from: location, paymentEventId }} to="/auth/sign-in" />
    case 'authenticated':
      return <Outlet />
  }
}
