/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react'
import { Navigate, Outlet, createBrowserRouter, useNavigate } from 'react-router-dom'
import { OrganizerLayout } from '../../components/layout/OrganizerLayout'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { CheckEmailPage } from '../../features/auth/CheckEmailPage'
import { SignInPage } from '../../features/auth/SignInPage'
import { SignUpPage } from '../../features/auth/SignUpPage'
import { CheckoutPage } from '../../features/checkout/CheckoutPage'
import { signOut } from '../../features/auth/auth.api'
import { EventEditorPage } from '../../features/events/EventEditorPage'
import { EventPreviewPage } from '../../features/events/EventPreviewPage'
import { OrganizerEventsPage } from '../../features/events/OrganizerEventsPage'
import { PublishedEventPage } from '../../features/events/PublishedEventPage'
import { OrganizerSetupPage } from '../../features/organizers/OrganizerSetupPage'
import { OrganizerPaymentsPage } from '../../features/payments/OrganizerPaymentsPage'
import { OrderConfirmationPage } from '../../features/orders/OrderConfirmationPage'
import { EventPolicyPage } from '../../features/moderation/EventPolicyPage'
import { OrganizerTermsPage } from '../../features/moderation/OrganizerTermsPage'
import { ModerationCasePage } from '../../features/moderation/ModerationCasePage'
import { ModerationQueuePage } from '../../features/moderation/ModerationQueuePage'
import { RequireStaff } from '../../features/moderation/RequireStaff'
import { useStaffRole } from '../../features/moderation/moderation.queries'
import { OrganizerTicketTiersPage } from '../../features/tickets/OrganizerTicketTiersPage'
import { PublicTicketEventPage } from '../../features/tickets/PublicTicketEventPage'
import { RequireOrganizer } from './RequireOrganizer'
import { RequireSession } from './RequireSession'
import { useSession } from '../../features/auth/SessionProvider'

function OrganizerShell() {
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

  return (
    <OrganizerLayout onSignOut={() => void handleSignOut()} staffRole={staffRoleQuery.data ?? null}>
      <FormErrorSummary errors={signOutError ? [signOutError] : []} title="Sign out failed" />
      <Outlet />
    </OrganizerLayout>
  )
}

export const appRouter = createBrowserRouter([
  { path: '/', element: <Navigate replace to="/auth/sign-in" /> },
  { path: '/events/:eventId', element: <PublicTicketEventPage /> },
  { path: '/events/:eventId/checkout', element: <CheckoutPage /> },
  { path: '/orders/:confirmationToken', element: <OrderConfirmationPage /> },
  { path: '/organizer-terms', element: <OrganizerTermsPage /> },
  { path: '/event-policy', element: <EventPolicyPage /> },
  { path: '/auth/sign-up', element: <SignUpPage /> },
  { path: '/auth/check-email', element: <CheckEmailPage /> },
  { path: '/auth/sign-in', element: <SignInPage /> },
  {
    element: <RequireSession />,
    children: [
      {
        element: <OrganizerShell />,
        children: [
          {
            path: '/organizer/setup',
            element: <OrganizerSetupPage />,
          },
          {
            element: <RequireStaff />,
            children: [
              { path: '/moderation', element: <ModerationQueuePage /> },
              { path: '/moderation/events/:eventId', element: <ModerationCasePage /> },
            ],
          },
          {
            element: <RequireOrganizer />,
            children: [
              {
                path: '/organizer/events',
                element: <OrganizerEventsPage />,
              },
              {
                path: '/organizer/settings/payments',
                element: <OrganizerPaymentsPage />,
              },
              {
                path: '/organizer/events/new',
                element: <EventEditorPage />,
              },
              {
                path: '/organizer/events/:eventId/edit',
                element: <EventEditorPage />,
              },
              {
                path: '/organizer/events/:eventId/preview',
                element: <EventPreviewPage />,
              },
              {
                path: '/organizer/events/:eventId/tickets',
                element: <OrganizerTicketTiersPage />,
              },
              {
                path: '/organizer/events/:eventId',
                element: <PublishedEventPage />,
              },
            ],
          },
        ],
      },
    ],
  },
])
