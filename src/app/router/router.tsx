import type { ComponentType } from 'react'
import { Navigate, createBrowserRouter, type RouteObject } from 'react-router-dom'
import type { TicketExperienceRuntime } from '../../features/ticket-experience/runtime/runtime.types'

const lazyComponent = <T extends Record<K, ComponentType>, K extends keyof T>(
  load: () => Promise<T>,
  exportName: K,
) => async () => ({ Component: (await load())[exportName] })

export function createAppRouter(runtime: TicketExperienceRuntime) {
  const routes: RouteObject[] = [
    { path: '/', element: <Navigate replace to="/auth/sign-in" /> },
    {
      path: '/events/:eventId',
      lazy: lazyComponent(() => import('../../features/tickets/PublicTicketEventPage'), 'PublicTicketEventPage'),
    },
    {
      path: '/events/:eventId/checkout',
      lazy: lazyComponent(() => import('../../features/checkout/CheckoutPage'), 'CheckoutPage'),
    },
    {
      path: '/orders/:confirmationToken',
      lazy: lazyComponent(() => import('../../features/orders/OrderConfirmationPage'), 'OrderConfirmationPage'),
    },
    {
      path: '/organizer-terms',
      lazy: lazyComponent(() => import('../../features/moderation/OrganizerTermsPage'), 'OrganizerTermsPage'),
    },
    {
      path: '/event-policy',
      lazy: lazyComponent(() => import('../../features/moderation/EventPolicyPage'), 'EventPolicyPage'),
    },
    {
      path: '/auth/sign-up',
      lazy: lazyComponent(() => import('../../features/auth/SignUpPage'), 'SignUpPage'),
    },
    {
      path: '/auth/check-email',
      lazy: lazyComponent(() => import('../../features/auth/CheckEmailPage'), 'CheckEmailPage'),
    },
    {
      path: '/auth/sign-in',
      lazy: lazyComponent(() => import('../../features/auth/SignInPage'), 'SignInPage'),
    },
    { path: '/tickets/:collectionBearer', Component: runtime.TicketCollectionRoute },
    { path: '/tickets/:collectionBearer/:ticketSelector', Component: runtime.TicketCollectionRoute },
    {
      id: 'session-shell',
      lazy: lazyComponent(() => import('./SessionShell'), 'SessionShell'),
      children: [
        {
          id: 'require-session',
          lazy: lazyComponent(() => import('./RequireSession'), 'RequireSession'),
          children: [
            {
              id: 'organizer-shell',
              lazy: lazyComponent(() => import('./OrganizerShell'), 'OrganizerShell'),
              children: [
                {
                  path: '/organizer/setup',
                  lazy: lazyComponent(
                    () => import('../../features/organizers/OrganizerSetupPage'),
                    'OrganizerSetupPage',
                  ),
                },
                {
                  id: 'require-staff',
                  lazy: lazyComponent(() => import('../../features/moderation/RequireStaff'), 'RequireStaff'),
                  children: [
                    {
                      path: '/moderation',
                      lazy: lazyComponent(
                        () => import('../../features/moderation/ModerationQueuePage'),
                        'ModerationQueuePage',
                      ),
                    },
                    {
                      path: '/moderation/events/:eventId',
                      lazy: lazyComponent(
                        () => import('../../features/moderation/ModerationCasePage'),
                        'ModerationCasePage',
                      ),
                    },
                  ],
                },
                {
                  id: 'require-organizer',
                  lazy: lazyComponent(() => import('./RequireOrganizer'), 'RequireOrganizer'),
                  children: [
                    {
                      path: '/organizer/events',
                      lazy: lazyComponent(
                        () => import('../../features/events/OrganizerEventsPage'),
                        'OrganizerEventsPage',
                      ),
                    },
                    {
                      path: '/organizer/settings/payments',
                      lazy: lazyComponent(
                        () => import('../../features/payments/OrganizerPaymentsPage'),
                        'OrganizerPaymentsPage',
                      ),
                    },
                    {
                      path: '/organizer/events/new',
                      lazy: lazyComponent(() => import('../../features/events/EventEditorPage'), 'EventEditorPage'),
                    },
                    {
                      path: '/organizer/events/:eventId/edit',
                      lazy: lazyComponent(() => import('../../features/events/EventEditorPage'), 'EventEditorPage'),
                    },
                    {
                      path: '/organizer/events/:eventId/preview',
                      lazy: lazyComponent(() => import('../../features/events/EventPreviewPage'), 'EventPreviewPage'),
                    },
                    {
                      path: '/organizer/events/:eventId/tickets',
                      lazy: lazyComponent(
                        () => import('../../features/tickets/OrganizerTicketTiersPage'),
                        'OrganizerTicketTiersPage',
                      ),
                    },
                    {
                      path: '/organizer/events/:eventId/dashboard',
                      Component: runtime.OrganizerDashboardRoute,
                    },
                    {
                      path: '/organizer/events/:eventId/orders',
                      lazy: lazyComponent(() => import('../../features/organizer-operations/OrganizerOrdersPage'), 'OrganizerOrdersPage'),
                    },
                    {
                      path: '/organizer/events/:eventId/orders/:orderId',
                      lazy: lazyComponent(() => import('../../features/organizer-operations/OrganizerOrderDetailPage'), 'OrganizerOrderDetailPage'),
                    },
                    {
                      path: '/organizer/events/:eventId/check-in',
                      Component: runtime.OrganizerScannerRoute,
                    },
                    {
                      path: '/organizer/events/:eventId',
                      lazy: lazyComponent(() => import('../../features/events/PublishedEventPage'), 'PublishedEventPage'),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    ...runtime.developmentRoutes,
  ]

  return createBrowserRouter(routes)
}
