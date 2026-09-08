/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs'
import { render, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { confirmation, event, eventId, moderationCase, organizer, organizerId, publicEvent, requirements, tier } from './fixtures'
import { encodeCheckoutCart } from '../features/checkout/checkout.cart'

const mocks = vi.hoisted(() => ({
  session: vi.fn(), ownedEvent: vi.fn(), ownedEvents: vi.fn(), organizer: vi.fn(), requirements: vi.fn(), policies: vi.fn(),
  tiers: vi.fn(), publicEvent: vi.fn(), confirmation: vi.fn(), moderationCase: vi.fn(), queue: vi.fn(),
  blocked: vi.fn(() => { throw new Error('Preview attempted a side effect') }),
}))
vi.mock('../lib/supabase/client', () => ({ supabase: new Proxy({}, { get: mocks.blocked }) }))
vi.mock('../features/auth/SessionProvider', () => ({ useSession: mocks.session }))
vi.mock('../features/moderation/staffContext', () => ({ useStaffContext: () => ({ role: 'moderator', staffUserId: organizerId }) }))
vi.mock('../features/auth/auth.api', () => ({ signInOrganizer: mocks.blocked, signUpOrganizer: mocks.blocked }))
vi.mock('../features/events/event.queries', () => ({
  useOwnedEvent: mocks.ownedEvent, useOwnedEvents: mocks.ownedEvents,
  useSaveEventDraft: mutation, useSaveEventRevision: mutation, usePublishEvent: mutation, useCancelOwnedEvent: mutation,
}))
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const route = path.split('?')[0].replace(eventId, ':eventId')
    const router = createMemoryRouter([{ path: route, element: consoleScreen ? <OrganizerLayout onSignOut={mocks.blocked} staffRole={key.startsWith('moderation') ? 'moderator' : null}>{page}</OrganizerLayout> : page }], { initialEntries: [path] })
    const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
    expect(view.container.querySelector('h1'), key).not.toBeNull()
    if (key === 'create-event') expect(view.container.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe('')
    if (key === 'edit-event') expect(view.container.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe(event.title)
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
    capture('check-email', '/auth/check-email', <CheckEmailPage />)
    capture('public-event', `/events/${eventId}`, <PublicTicketEventPage />)
    capture('checkout', `/events/${eventId}/checkout?${encodeCheckoutCart([{ tierId: tier.id, quantity: 1 }])}`, <CheckoutPage />)
    capture('confirmation', '/orders/preview-token', <OrderConfirmationPage />)
    capture('organizer-setup', '/organizer/setup', <OrganizerSetupPage />, true)
    capture('organizer-events', '/organizer/events', <OrganizerEventsPage />, true)
    capture('create-event', '/organizer/events/new', <EventEditorPage />, true)
    capture('edit-event', `/organizer/events/${eventId}/edit`, <EventEditorPage />, true)
    capture('event-preview', `/organizer/events/${eventId}/preview`, <EventPreviewPage />, true)
    capture('ticket-tiers', `/organizer/events/${eventId}/tickets`, <OrganizerTicketTiersPage />, true)
    mocks.ownedEvent.mockReturnValue(loaded({ ...event, status: 'published', published_at: '2026-09-01T12:00:00Z' }))
    capture('published-event', `/organizer/events/${eventId}`, <PublishedEventPage />, true)
    capture('moderation', '/moderation', <ModerationQueuePage />, true)
    capture('moderation-case', `/moderation/events/${eventId}`, <ModerationCasePage />, true)
    expect(mocks.blocked).not.toHaveBeenCalled()
    const file = `${process.cwd()}/src/preview/screens.json`
    if (process.env.UPDATE_PREVIEW_SCREENS === '1') writeFileSync(file, `${JSON.stringify(screens, null, 2)}\n`)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(screens)
  } finally {
    vi.unstubAllGlobals()
  }
})
