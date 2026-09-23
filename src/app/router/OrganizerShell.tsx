import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { OperationsLayout } from '../../features/organizer-operations/OperationsUi'
import { OrganizerLayout } from '../../components/layout/OrganizerLayout'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { useSignOut } from '../../features/auth/SignOutProvider'
import { useSession } from '../../features/auth/SessionProvider'
import { useStaffRole } from '../../features/moderation/moderation.queries'
import { useOwnedEvent } from '../../features/events/event.queries'
import { z } from 'zod'
import '../../features/events/organizerEventWorkflow.css'

export function OrganizerShell() {
  const navigate = useNavigate()
  const sessionState = useSession()
  const staffUserId = sessionState.status === 'authenticated' ? sessionState.user.id : ''
  const staffRoleQuery = useStaffRole(staffUserId)
  const controller = useSignOut()
  const signOutError = controller.error
  async function handleSignOut() {
    if (sessionState.status !== 'authenticated') return
    const result = await controller.signOut(sessionState.session)
    if (result.localSignedOut && result.isCurrent()) navigate('/auth/sign-in', { replace: true })
  }

  const { pathname, search } = useLocation()
  const match = pathname.match(/^\/organizer\/events\/([^/]+)\/(dashboard|orders|check-in|registrations)(?:\/|$)/)
  const eventId = pathname.match(/^\/organizer\/events\/([^/]+)(?:\/|$)/)?.[1] ?? ''
  const ownedEvent = useOwnedEvent(z.uuid().safeParse(eventId).success ? eventId : '', staffUserId)
  const admissionType = ownedEvent.data?.admission_type
  const query = new URLSearchParams(search)
  const creationEdit = pathname.endsWith('/edit') && (query.get('resume') === '1' || query.get('saved') === '1' || ['basics', 'date-location', 'ticket-type', 'details', 'requirements'].includes(query.get('step') ?? ''))
  const creationDetail = ownedEvent.data?.status === 'draft' && (pathname.endsWith('/tickets') || pathname.endsWith('/preview'))
  const creationOutcome = query.get('created') === '1' && pathname === `/organizer/events/${eventId}`
  const eventWorkflow = pathname.startsWith('/organizer/events/') && !match
  const outlet = eventWorkflow ? <div className="organizer-event-workflow"><Outlet /></div> : <Outlet />
  if (pathname === '/organizer/settings/storefront/preview' || pathname.startsWith('/organizer/setup') || pathname === '/organizer/events/new' || creationEdit || creationDetail || creationOutcome) return outlet
  if (pathname === '/organizer/events' || pathname.startsWith('/organizer/settings') || match) return <OperationsLayout eventId={match?.[1]} admissionType={admissionType === 'paid' || admissionType === 'free' ? admissionType : null} signOutPending={controller.pending} onSignOut={() => void handleSignOut()} staffRole={staffRoleQuery.data ?? null}><FormErrorSummary errors={signOutError ? [signOutError] : []} title="Sign out failed" /><Outlet /></OperationsLayout>
  return (
    <OrganizerLayout signOutPending={controller.pending} onSignOut={() => void handleSignOut()} staffRole={staffRoleQuery.data ?? null}>
      <FormErrorSummary errors={signOutError ? [signOutError] : []} title="Sign out failed" />
      {outlet}
    </OrganizerLayout>
  )
}
