import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { OperationsLayout } from '../../features/organizer-operations/OperationsUi'
import { OrganizerLayout } from '../../components/layout/OrganizerLayout'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { signOut } from '../../features/auth/auth.api'
import { useSession } from '../../features/auth/SessionProvider'
import { useStaffRole } from '../../features/moderation/moderation.queries'

export function OrganizerShell() {
  const navigate = useNavigate()
  const sessionState = useSession()
  const staffUserId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const staffRoleQuery = useStaffRole(staffUserId)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  async function handleSignOut() {
    setSignOutError(null)

    try {
      await signOut()
      navigate('/auth/sign-in', { replace: true })
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Sign out failed. Try again.')
    }
  }

  const { pathname } = useLocation()
  const match = pathname.match(/^\/organizer\/events\/([^/]+)\/(dashboard|orders|check-in)(?:\/|$)/)
  if (pathname === '/organizer/events' || match) return <OperationsLayout eventId={match?.[1]} onSignOut={() => void handleSignOut()} staffRole={staffRoleQuery.data ?? null}><FormErrorSummary errors={signOutError ? [signOutError] : []} title="Sign out failed" /><Outlet /></OperationsLayout>
  return (
    <OrganizerLayout onSignOut={() => void handleSignOut()} staffRole={staffRoleQuery.data ?? null}>
      <FormErrorSummary errors={signOutError ? [signOutError] : []} title="Sign out failed" />
      <Outlet />
    </OrganizerLayout>
  )
}
