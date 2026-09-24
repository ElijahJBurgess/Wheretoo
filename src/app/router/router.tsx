import { captureEventStatusAccess } from '../../features/event-changes/eventStatus.session'
import { captureTicketAccess } from '../../features/ticket-delivery/delivery.session'
import type { ComponentType } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { DiscoveryHomeRedirect } from '../../features/discovery/DiscoveryHomeRedirect'
import type { TicketExperienceRuntime } from '../../features/ticket-experience/runtime/runtime.types'
import { RouteErrorFallback, RouteLoadingFallback, UnmatchedRouteFallback } from './RouteFallback'

const lazyComponent = <T extends Record<K, ComponentType>, K extends keyof T>(
  load: () => Promise<T>,
  exportName: K,
) => async () => ({ Component: (await load())[exportName] })


function withSanitizedErrorFallback(routes: RouteObject[]): RouteObject[] {
  return routes.map(route => {
    const errorElement = route.errorElement ?? <RouteErrorFallback />
    const hydrateFallbackElement = route.hydrateFallbackElement ?? <RouteLoadingFallback />
    if (route.index === true) return { ...route, errorElement, hydrateFallbackElement }
    return {
      ...route,
      children: route.children ? withSanitizedErrorFallback(route.children) : undefined,
      errorElement,
      hydrateFallbackElement,
    }
  })
}

export function createAppRoutes(runtime: TicketExperienceRuntime) {
  captureEventStatusAccess()
  captureTicketAccess()
  const routes: RouteObject[] = [
    { path: '/tickets/recover', lazy: lazyComponent(() => import('../../features/ticket-delivery/TicketRecoveryPage'), 'TicketRecoveryPage') },
    { path: '/ticket-access', lazy: lazyComponent(() => import('../../features/ticket-delivery/TicketEmailAccessPage'), 'TicketEmailAccessPage') },
    { path: '/event-status', lazy: lazyComponent(() => import('../../features/event-changes/EventStatusPage'), 'EventStatusPage') },
    { path: '/refund-details', lazy: lazyComponent(() => import('../../features/refunds/RefundDetailsPage'), 'RefundDetailsPage') },
    { path: '/events/:eventId/rsvp', lazy: lazyComponent(() => import('../../features/rsvp/RsvpPage'), 'RsvpPage') },
    { path: '/rsvp/:collectionBearer', lazy: lazyComponent(() => import('../../features/rsvp/RsvpConfirmationPage'), 'RsvpConfirmationPage') },
    { path: '/', element: <DiscoveryHomeRedirect /> },
    { path: '/discover', lazy: lazyComponent(() => import('../../features/discovery/DiscoveryPage'), 'DiscoveryPage') },
    {
      path: '/events/checkout',
      lazy: lazyComponent(() => import('../../features/checkout/CheckoutPage'), 'CheckoutPage'),
    },
    {
      path: '/events//checkout',
      lazy: lazyComponent(() => import('../../features/checkout/CheckoutPage'), 'CheckoutPage'),
    },
    {
      path: '/events/:eventId',
      lazy: lazyComponent(() => import('../../features/tickets/PublicTicketEventPage'), 'PublicTicketEventPage'),
    },
    {
      path: '/events/:eventId/tickets',
      lazy: lazyComponent(() => import('../../features/tickets/PublicTicketEventPage'), 'PublicTicketSelectionPage'),
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
                  path: '/organizer/setup/identity',
                  lazy: lazyComponent(() => import('../../features/storefront/StorefrontIdentityPage'), 'StorefrontIdentityPage'),
                },
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
                      path: '/organizer/settings',
                      lazy: lazyComponent(() => import('../../features/organizer-settings/SettingsLayout'), 'SettingsLayout'),
                      children: [
                        { index: true, lazy: lazyComponent(() => import('../../features/organizer-settings/SettingsLayout'), 'SettingsIndexPage') },
                        { path: 'storefront', lazy: lazyComponent(() => import('../../features/storefront/OrganizerStorefrontEditorPage'), 'OrganizerStorefrontEditorPage') },
                        { path: 'storefront/preview', lazy: lazyComponent(() => import('../../features/storefront/StorefrontPreviewPage'), 'StorefrontPreviewPage') },
                        { path: 'account', lazy: lazyComponent(() => import('../../features/organizer-settings/AccountSecurityPage'), 'AccountSecurityPage') },
                        { path: 'profile', lazy: lazyComponent(() => import('../../features/organizer-settings/OrganizerProfilePage'), 'OrganizerProfilePage') },
                        { path: 'payments', lazy: lazyComponent(() => import('../../features/payments/OrganizerPaymentsPage'), 'OrganizerPaymentsPage') },
                        { path: 'help', lazy: lazyComponent(() => import('../../features/organizer-settings/HelpLegalPage'), 'HelpLegalPage') },
                        { path: 'actions', lazy: lazyComponent(() => import('../../features/organizer-settings/AccountActionsPage'), 'AccountActionsPage') },
                      ],
                    },
                    {
                      path: '/organizer/events/new',
                      lazy: lazyComponent(() => import('../../features/events/EventEditorPage'), 'EventEditorPage'),
                    },
                    {
                      path: '/organizer/events/:eventId/edit',
                      lazy: lazyComponent(() => import('../../features/events/EventEditorPage'), 'EventEditorPage'),
                    },
                    { path: '/organizer/events/:eventId/email-attendees', lazy: lazyComponent(() => import('../../features/organizer-messages/OrganizerMessagePage'), 'OrganizerMessagePage') },
                    { path: '/organizer/events/:eventId/changes', lazy: lazyComponent(() => import('../../features/event-changes/EventChangesPage'), 'EventChangesPage') },
                    { path: '/organizer/events/:eventId/cancellation', lazy: lazyComponent(() => import('../../features/event-changes/EventCancellationPage'), 'EventCancellationPage') },
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
                    { path: '/organizer/events/:eventId/registrations', lazy: lazyComponent(() => import('../../features/organizer-operations/OrganizerRegistrationLookup'), 'OrganizerRegistrationLookup') },
                    { path: '/organizer/events/:eventId/registrations/:registrationId', lazy: lazyComponent(() => import('../../features/organizer-operations/OrganizerRegistrationDetailPage'), 'OrganizerRegistrationDetailPage') },
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
                      lazy: lazyComponent(() => import('../../features/organizer-operations/CheckInLayout'), 'CheckInLayout'),
                      children: [
                        { index: true, lazy: lazyComponent(() => import('../../features/organizer-operations/CheckInHomePage'), 'CheckInHomePage') },
                        { path: 'scan', Component: runtime.OrganizerScannerRoute },
                        { path: 'find', lazy: lazyComponent(() => import('../../features/organizer-operations/FindGuestPage'), 'FindGuestPage') },
                        { path: 'find/registrations/:registrationId/:ticketId', lazy: lazyComponent(() => import('../../features/organizer-operations/FreeGuestTicketDetailPage'), 'FreeGuestTicketDetailPage') },
                        { path: 'find/:orderId/:ticketId', lazy: lazyComponent(() => import('../../features/organizer-operations/GuestTicketDetailPage'), 'GuestTicketDetailPage') },
                      ],
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
    { path: '/:organizerHandle', lazy: lazyComponent(() => import('../../features/storefront/OrganizerStorefrontPage'), 'OrganizerStorefrontPage') },
    { path: '*', element: <UnmatchedRouteFallback /> },
  ]

  return withSanitizedErrorFallback(routes)
}

export function createAppRouter(runtime: TicketExperienceRuntime) {
  return createBrowserRouter(createAppRoutes(runtime))
}
