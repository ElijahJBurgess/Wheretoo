import { Outlet } from 'react-router-dom'
import { AsyncState } from '../../components/ui/AsyncState'
import { Button } from '../../components/ui/Button'
import { useSession } from '../auth/SessionProvider'
import { useStaffRole } from './moderation.queries'

export function RequireStaff() {
  const sessionState = useSession()
  const staffUserId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const roleQuery = useStaffRole(staffUserId)

  if (sessionState.status !== 'authenticated' || roleQuery.isPending) {
    return <AsyncState status="loading" title="Checking moderation access" />
  }

  if (roleQuery.isError) {
    return (
      <AsyncState
        action={<Button onClick={() => void roleQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="error"
        title="Moderation access could not be confirmed"
      />
    )
  }

  if (roleQuery.data === null || roleQuery.data === undefined) {
    return (
      <AsyncState
        description="An active moderator or admin role is required."
        status="empty"
        title="Moderation access required"
      />
    )
  }

  return <Outlet context={{ role: roleQuery.data, staffUserId }} />
}
