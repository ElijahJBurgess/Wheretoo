/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs'
import { render, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { PropsWithChildren, ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { confirmation, event, eventId, moderationCase, organizer, organizerId, publicEvent, requirements, tier } from './fixtures'
import { encodeCheckoutCart } from '../features/checkout/checkout.cart'
import { testContext } from '../features/event-changes/eventChanges.fixtures'

const mocks = vi.hoisted(() => ({
  session: vi.fn(), ownedEvent: vi.fn(), ownedEvents: vi.fn(), organizer: vi.fn(), requirements: vi.fn(), policies: vi.fn(),
  tiers: vi.fn(), publicEvent: vi.fn(), confirmation: vi.fn(), moderationCase: vi.fn(), queue: vi.fn(), eventChangeContext: vi.fn(), eventMetrics: vi.fn(),
  blocked: vi.fn(() => { throw new Error('Preview attempted a side effect') }),
}))
vi.mock('../features/event-images/eventImages.queries', () => ({ useEventImages: () => loaded([]), useEventCoverState: () => loaded({ revision: 0, images: [], latestGenerationId: null }) }))
vi.mock('../features/event-images/publicEventImages', () => ({ usePublicEventImages: () => loaded([]) }))
vi.mock('../lib/supabase/client', () => ({ supabase: new Proxy({}, { get: mocks.blocked }) }))
vi.mock('../features/auth/SessionProvider', () => ({ useSession: mocks.session, SessionProvider: ({ children }: PropsWithChildren) => children }))
vi.mock('../features/moderation/staffContext', () => ({ useStaffContext: () => ({ role: 'moderator', staffUserId: organizerId }) }))
vi.mock('../features/auth/auth.api', () => ({ signInOrganizer: mocks.blocked, signUpOrganizer: mocks.blocked }))
vi.mock('../features/events/event.queries', () => ({
  useOwnedEvent: mocks.ownedEvent, useOwnedEvents: mocks.ownedEvents,
  useSaveEventDraft: mutation, useSaveEventRevision: mutation, usePublishEvent: mutation, useCancelOwnedEvent: mutation,
}))
vi.mock('../features/event-changes/eventChanges.queries', () => ({ useEventChangeContext: mocks.eventChangeContext }))
vi.mock('../features/organizer-operations/operations.queries', () => ({ useEventMetrics: mocks.eventMetrics }))
vi.mock('../features/organizers/organizer.queries', () => ({ useOrganizer: mocks.organizer, useSaveOrganizer: mutation }))
vi.mock('../features/tickets/ticket.queries', () => ({ useOwnedTicketTiers: mocks.tiers, useSaveTicketTiers: mutation }))
vi.mock('../features/tickets/publicTicketing.queries', () => ({ usePublicTicketingEvent: mocks.publicEvent }))
vi.mock('../features/checkout/checkout.queries', () => ({ useCheckoutPublicEvent: mocks.publicEvent }))
vi.mock('../features/checkout/checkout.api', () => ({ cancelCheckout: mocks.blocked, createCheckout: mocks.blocked, isStripeCheckoutUrl: () => false }))
vi.mock('../features/orders/order.queries', () => ({ useOrderConfirmation: mocks.confirmation }))
vi.mock('../features/payments/payment.queries', () => ({ useConnectStatus: () => loaded({ status: 'ready' }) }))
vi.mock('../features/moderation/moderation.queries', () => ({
  moderationKeys: {}, useOwnedEventRequirements: mocks.requirements, useRequiredEventPolicies: mocks.policies,
  useSaveEventRequirements: mutation, useAcceptCurrentEventPolicies: mutation, useReportPublicEvent: mutation,
  usePublicEvent: mocks.publicEvent, useCurrentEventReviewRequest: () => loaded(null),
  useRequestEventReview: mutation, useWithdrawEventReview: mutation,
  useModerationQueue: mocks.queue, useModerationCase: mocks.moderationCase,
  useSubmitModerationAction: mutation, useResolveLegacyPublicHistory: mutation,
}))

import { SignInPage } from '../features/auth/SignInPage'
import { SignUpPage } from '../features/auth/SignUpPage'
import { CheckEmailPage } from '../features/auth/CheckEmailPage'
import { CheckoutPage } from '../features/checkout/CheckoutPage'
import { OrderConfirmationPage } from '../features/orders/OrderConfirmationPage'
import { PublicTicketEventPage } from '../features/tickets/PublicTicketEventPage'
import { OrganizerSetupPage } from '../features/organizers/OrganizerSetupPage'
import { OrganizerEventsPage } from '../features/events/OrganizerEventsPage'
import { EventEditorPage } from '../features/events/EventEditorPage'
import { EventPreviewPage } from '../features/events/EventPreviewPage'
import { PublishedEventPage } from '../features/events/PublishedEventPage'
import { OrganizerTicketTiersPage } from '../features/tickets/OrganizerTicketTiersPage'
import { ModerationQueuePage } from '../features/moderation/ModerationQueuePage'
import { ModerationCasePage } from '../features/moderation/ModerationCasePage'
import { OrganizerLayout } from '../components/layout/OrganizerLayout'

function mutation() { return { isPending: false, mutateAsync: mocks.blocked, reset: () => undefined } }
function loaded<T>(data: T) { return { data, isPending: false, isError: false, refetch: mocks.blocked } }

// Capture actual mounted markup (including form hydration), never ship the mocked app.
// Browser previews receive HTML only: no handlers, providers, clients, or credentials.
it('keeps visual fixtures current with the real screens, without calling services', () => {
  vi.stubGlobal('fetch', mocks.blocked)
  mocks.session.mockReturnValue({ status: 'authenticated', session: {}, user: { id: organizerId, user_metadata: {} } })
  mocks.ownedEvent.mockImplementation((id: string) => loaded(id ? event : null))
  mocks.eventChangeContext.mockImplementation((id: string) => loaded(id ? { ...testContext(event), requirements } : undefined))
  mocks.eventMetrics.mockReturnValue(loaded({ sold: 24, capacity: 100, grossSalesMinor: 60000 }))
  mocks.ownedEvents.mockReturnValue(loaded([event, { ...event, id: 'preview-published', status: 'published' }]))
  mocks.organizer.mockReturnValue(loaded(organizer))
  mocks.requirements.mockReturnValue(loaded(requirements))
  mocks.policies.mockReturnValue(loaded([requirements.organizerTerms, requirements.eventPolicy]))
  mocks.tiers.mockReturnValue(loaded([tier]))
  mocks.publicEvent.mockReturnValue(loaded(publicEvent))
  mocks.confirmation.mockReturnValue({ ...loaded(confirmation), isTimedOut: false, retry: mocks.blocked })
  mocks.moderationCase.mockReturnValue(loaded(moderationCase))
  mocks.queue.mockReturnValue(loaded([moderationCase]))

  const screens: Record<string, string> = {}
  function capture(key: string, path: string, page: ReactNode, consoleScreen = false) {
    const sideEffectsBeforeCapture = mocks.blocked.mock.calls.length
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const route = path.split('?')[0].replace(eventId, ':eventId')
    const router = createMemoryRouter([{ path: route, element: consoleScreen ? <OrganizerLayout onSignOut={mocks.blocked} staffRole={key.startsWith('moderation') ? 'moderator' : null}>{page}</OrganizerLayout> : page }], { initialEntries: [path] })
    const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
    expect(view.container.querySelector('h1'), key).not.toBeNull()
    if (key === 'create-event') expect(view.container.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe('')
    if (key === 'edit-event') {
      expect(view.container.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe(event.title)
      expect(view.container.querySelector('.event-save-state')).toHaveTextContent('Saved')
      expect(view.container.querySelector(`a[href="/organizer/events/${eventId}/changes"]`)).not.toBeNull()
    }
    expect(view.container.textContent, key).not.toMatch(/Unexpected Application Error|Loading your|Loading event|could not load/)
    // Inputs changed through form hydration need their DOM values serialized.
    view.container.querySelectorAll('input').forEach((input) => {
      input.setAttribute('value', input.value)
      if (input.checked) input.setAttribute('checked', '')
      else input.removeAttribute('checked')
    })
    view.container.querySelectorAll('textarea').forEach((input) => { input.textContent = input.value })
    view.container.querySelectorAll('option').forEach((option) => {
      if (option.selected) option.setAttribute('selected', '')
      else option.removeAttribute('selected')
    })
    // Defense beyond inert: snapshots cannot navigate or submit, even without JS.
    view.container.querySelectorAll('[href], [action], [formaction]').forEach((node) => {
      node.removeAttribute('href'); node.removeAttribute('action'); node.removeAttribute('formaction')
    })
    expect(view.container.querySelector('script, iframe, object, embed')).toBeNull()
    expect(mocks.blocked.mock.calls.length, key).toBe(sideEffectsBeforeCapture)
    const ids = new Map<string, string>()
    screens[key] = view.container.innerHTML.replace(/_r_[\da-z]+_/g, (id) => {
      if (!ids.has(id)) ids.set(id, `_preview_${ids.size}_`)
      return ids.get(id)!
    })
    cleanup()
    router.dispose()
    client.clear()
  }
  try {
    capture('sign-in', '/auth/sign-in', <SignInPage />)
    capture('sign-up', '/auth/sign-up', <SignUpPage />)
    mocks.session.mockReturnValue({ status: 'anonymous', session: null, user: null })
    capture('check-email', '/auth/check-email', <CheckEmailPage />)
    mocks.session.mockReturnValue({ status: 'authenticated', session: {}, user: { id: organizerId, user_metadata: {} } })
    capture('public-event', `/events/${eventId}`, <PublicTicketEventPage />)
    capture('checkout', `/events/${eventId}/checkout?${encodeCheckoutCart([{ tierId: tier.id, quantity: 1 }])}`, <CheckoutPage />)
    capture('confirmation', '/orders/preview-token', <OrderConfirmationPage />)
    capture('organizer-setup', '/organizer/setup', <OrganizerSetupPage />)
    capture('organizer-events', '/organizer/events', <OrganizerEventsPage />, true)
    capture('create-event', '/organizer/events/new', <EventEditorPage />)
    capture('edit-event', `/organizer/events/${eventId}/edit`, <EventEditorPage />, true)
    capture('event-preview', `/organizer/events/${eventId}/preview`, <EventPreviewPage />)
    capture('ticket-tiers', `/organizer/events/${eventId}/tickets`, <OrganizerTicketTiersPage />)
    mocks.ownedEvent.mockReturnValue(loaded({ ...event, status: 'published', published_at: '2026-09-01T12:00:00Z' }))
    capture('published-event', `/organizer/events/${eventId}`, <PublishedEventPage />, true)
    capture('moderation', '/moderation', <ModerationQueuePage />, true)
    capture('moderation-case', `/moderation/events/${eventId}`, <ModerationCasePage />, true)
    expect(mocks.blocked.mock.calls.length).toBe(0)
    const file = `${process.cwd()}/src/preview/screens.json`
    if (process.env.UPDATE_PREVIEW_SCREENS === '1') writeFileSync(file, `${JSON.stringify(screens, null, 2)}\n`)
    const savedScreens = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
    expect(Object.keys(savedScreens)).toEqual(Object.keys(screens))
    Object.entries(screens).forEach(([key, html]) => expect(savedScreens[key], key).toBe(html))
  } finally {
    vi.unstubAllGlobals()
  }
})
