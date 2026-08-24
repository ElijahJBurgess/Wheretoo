import { Navigate, Outlet } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { useSession } from '../../features/auth/SessionProvider'
import { useOrganizer } from '../../features/organizers/organizer.queries'

export function RequireOrganizer() {
  const sessionState = useSession()
  const userId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const organizerQuery = useOrganizer(userId)

  if (sessionState.status !== 'authenticated' || organizerQuery.isPending) {
    return <AsyncState status="loading" title="Loading your organizer profile" />
  }

  if (organizerQuery.isError) {
    return (
      <AsyncState
        action={<Button onClick={() => void organizerQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="error"
        title="Your organizer profile could not load"
      />
    )
  }

  if (!organizerQuery.data?.onboarding_completed_at) {
    return <Navigate replace to="/organizer/setup" />
  }

  return <Outlet />
}
