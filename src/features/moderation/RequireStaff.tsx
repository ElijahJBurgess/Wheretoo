import { Outlet } from 'react-router-dom'
import { ReadState } from '../../components/ui/ReadState'
import { Button } from '../../components/ui/Button'
import { useSession } from '../auth/SessionProvider'
import { useStaffRole } from './moderation.queries'

export function RequireStaff() {
  const sessionState = useSession()
  const staffUserId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const roleQuery = useStaffRole(staffUserId)

  if (sessionState.status !== 'authenticated' || roleQuery.isPending) {
    return <ReadState headingAs="h1" paused={roleQuery.fetchStatus === 'paused'} status="loading" title="Checking moderation access" />
  }

  if (roleQuery.isError || roleQuery.data === undefined) {
    return (
      <ReadState headingAs="h1"
        action={<Button onClick={() => void roleQuery.refetch()}>Try again</Button>}
        description="Check your connection, then try again."
        status="unavailable"
        title="Moderation access could not be confirmed"
      />
    )
  }

  if (roleQuery.data === null) {
    return (
      <ReadState headingAs="h1"
        description="An active moderator or admin role is required."
        status="denied"
        title="Moderation access required"
      />
    )
  }

  return <Outlet context={{ role: roleQuery.data, staffUserId }} />
}
