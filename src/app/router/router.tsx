/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react'
import { Navigate, Outlet, createBrowserRouter, useNavigate } from 'react-router-dom'
import { OrganizerLayout } from '../../components/layout/OrganizerLayout'
import { FormErrorSummary } from '../../components/ui/FormErrorSummary'
import { CheckEmailPage } from '../../features/auth/CheckEmailPage'
import { SignInPage } from '../../features/auth/SignInPage'
import { SignUpPage } from '../../features/auth/SignUpPage'
import { signOut } from '../../features/auth/auth.api'
import { EventEditorPage } from '../../features/events/EventEditorPage'
import { EventPreviewPage } from '../../features/events/EventPreviewPage'
import { OrganizerEventsPage } from '../../features/events/OrganizerEventsPage'
import { PublishedEventPage } from '../../features/events/PublishedEventPage'
import { OrganizerSetupPage } from '../../features/organizers/OrganizerSetupPage'
import { RequireOrganizer } from './RequireOrganizer'
import { RequireSession } from './RequireSession'

function OrganizerShell() {
  const navigate = useNavigate()
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
    <OrganizerLayout onSignOut={() => void handleSignOut()}>
      <FormErrorSummary errors={signOutError ? [signOutError] : []} title="Sign out failed" />
      <Outlet />
    </OrganizerLayout>
  )
}

export const appRouter = createBrowserRouter([
  { path: '/', element: <Navigate replace to="/auth/sign-in" /> },
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
            element: <RequireOrganizer />,
            children: [
              {
                path: '/organizer/events',
                element: <OrganizerEventsPage />,
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
