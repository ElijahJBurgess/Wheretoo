import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { assertEmailWorkerPlan, assertCompletedEmailWorker, retainedRefundId, type EmailProofHashes, type EmailQueueRow, type EmailWorkerTarget } from './support/spec14EmailGuard'
import { z } from 'zod'
import type { Database } from '../../src/lib/supabase/database.types'
import type { EventMetrics } from '../../src/features/organizer-operations/operations.schemas'
import { dateTime as formatOperationDateTime } from '../../src/features/organizer-operations/operations.format'
import { expect, test, type Frame, type Page, type Request, type Response } from '@playwright/test'
import {
  confirmLocalSignup, confirmLocalEmailChange, localAuthMessages, control, dbJson, eventThroughUi, journey, organizerLogin,
  origin, negativeGrant, privateGoto, qrCamera, quote, realContext, requireId, saveScenario,
  ticketFacts, ticketQr, type Scenario,
} from './support/spec14Harness'

// Select one exact journey with --grep using the documented prerequisite order.
// File order is not a walkthrough: refunds/cancellation invalidate later controls.
// Resume the same private ledger; no test resets scenario history.
const emailFor = (value: Scenario, source: string) => `${source}-${value.runId}@spec14.test`
function isOriginalPaidCardRead(request: Request, value: Scenario) {
  return new URL(request.url()).pathname.endsWith('/rpc/get_organizer_event_metrics')
    && request.postDataJSON()?.p_event_id === value.paidEventId
    && new URL(request.frame().url()).pathname === '/organizer/events'
}
async function discover(page: Page, eventId: string) {
  await page.goto(origin + '/discover')
  const event = page.locator(`a[href="/events/${eventId}"]`).first()
  await expect(event).toBeVisible()
  await event.click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/events/' + eventId)
}
async function continueToCheckout(page: Page) {
  const eventId = new URL(page.url()).pathname.match(/^\/events\/([a-f0-9-]{36})(?:\/tickets)?$/)?.[1]
  if (!eventId) throw new Error('Current ticket selection has no canonical event route')
  const cart = await page.locator('.public-ticket-tier__quantity input').evaluateAll(inputs => inputs
    .map(input => input as HTMLInputElement).filter(input => input.valueAsNumber > 0)
    .map(input => `${input.id.replace('ticket-quantity-', '')}:${input.valueAsNumber}`).sort())
  expect(cart.length).toBeGreaterThan(0)
  await expect.poll(() => new URL(page.url()).searchParams.getAll('item').sort()).toEqual(cart)
  await page.getByRole('button', { name: 'Continue to checkout', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/events/${eventId}/checkout`)
  expect(new URL(page.url()).searchParams.getAll('item').sort()).toEqual(cart)
}
async function collection(page: Page) {
  for (let step = 0; step < 2; step++) {
    await expect.poll(async () => new URL(page.url()).pathname.startsWith('/tickets/') || await page.getByRole('link', { name: /^View( your)? tickets$/ }).isVisible()).toBe(true)
    if (new URL(page.url()).pathname.startsWith('/tickets/')) break
    const link = page.getByRole('link', { name: /^View( your)? tickets$/ })
    const href = await link.getAttribute('href')
    if (!href) throw new Error('Original ticket link has no navigation target')
    const targetPath = new URL(href, origin).pathname
    await link.click()
    await expect.poll(() => new URL(page.url()).pathname === targetPath, { message: 'Original ticket-link target navigation has completed' }).toBe(true)
  }
  await expect(page.locator('.buyer-wallet-row')).toHaveCount(3)
  return page.url()
}
async function separateFreeSource(page: Page, value: Scenario, eventId: string, key: string, recipient: string) {
  const saved = value.results[key] as { registrationId: string; collectionUrl: string } | undefined
  if (saved) return saved
  await discover(page, eventId)
  await page.getByRole('link', { name: /RSVP/ }).click()
  await expect.poll(async () => await page.getByRole('button', { name: 'Increase quantity', exact: true }).isVisible() || await page.getByRole('button', { name: 'Check RSVP status', exact: true }).isVisible() || await page.getByRole('link', { name: /^View( your)? tickets$/ }).isVisible()).toBe(true)
  if (await page.getByRole('button', { name: 'Check RSVP status', exact: true }).isVisible()) await page.getByRole('button', { name: 'Check RSVP status', exact: true }).click()
  if (await page.getByRole('button', { name: 'Increase quantity', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Increase quantity', exact: true }).click({ clickCount: 2 })
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel('Full name', { exact: true }).fill('Free Guest')
    await page.getByLabel('Email address', { exact: true }).fill(recipient)
    await page.getByRole('button', { name: 'Confirm RSVP', exact: true }).click()
  }
  const collectionUrl = await collection(page)
  const rows = dbJson<{ id: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id)), '[]'::jsonb) from public.free_registrations where event_id=${quote(eventId)} and email=${quote(recipient)};`)
  if (rows.length !== 1) throw new Error('Free source identity is ambiguous; no replacement registration permitted')
  const result = { registrationId: rows[0].id, collectionUrl }
  value.results[key] = result; saveScenario(value)
  return result
}
async function manual(page: Page, eventId: string, sourceId: string, ticketId: string, free: boolean) {
  await page.goto(origin + `/organizer/events/${eventId}/check-in/find`)
  await page.getByLabel('Search guest name or email', { exact: true }).fill(free ? 'Free Guest' : 'Paid Guest')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const suffix = free ? `find/registrations/${sourceId}/${ticketId}` : `find/${sourceId}/${ticketId}`
  await page.locator(`a[href$="/${suffix}"]`).click()
  await expect.poll(async () => await page.getByRole('heading', { name: 'Already checked in', exact: true }).isVisible() || await page.getByRole('button', { name: 'Check in guest', exact: true }).isVisible()).toBe(true)
  if (await page.getByRole('heading', { name: 'Already checked in', exact: true }).isVisible()) return
  if (free) await expect(page.getByText(/Ticket 2 of 3/)).toBeVisible()
  await page.getByRole('button', { name: 'Check in guest', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Admit guest', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Admitted', exact: true })).toBeVisible()
}

async function separatePaidSource(page: Page, value: Scenario, eventId: string, key: string, recipient = emailFor(value, 'changes')) {
  const saved = value.results[key] as { orderId: string; collectionUrl: string } | undefined
  if (saved) return saved
  const checkoutUrl = value.results[key + 'CheckoutUrl']
  if (typeof checkoutUrl === 'string') await privateGoto(page, checkoutUrl)
  else {
    await discover(page, eventId)
    await page.getByLabel('General Admission quantity', { exact: true }).fill('2')
    await page.getByLabel('VIP quantity', { exact: true }).fill('1')
    await continueToCheckout(page)
    value.results[key + 'CheckoutUrl'] = page.url(); saveScenario(value)
  }
  await expect.poll(async () => await page.getByLabel('Your name', { exact: true }).isVisible() || await page.getByRole('button', { name: 'Complete simulated payment', exact: true }).isVisible() || await page.getByRole('link', { name: /^View( your)? tickets$/ }).isVisible() || await page.locator('.buyer-wallet-row').count() === 3).toBe(true)
  if (await page.getByLabel('Your name', { exact: true }).isVisible()) {
    await page.getByLabel('Your name', { exact: true }).fill('Paid Guest')
    await page.getByLabel('Email address', { exact: true }).fill(recipient)
    await page.getByRole('button', { name: /Continue to secure payment|Retry same checkout/, exact: true }).click()
  }
  await expect.poll(async () => await page.getByRole('button', { name: 'Complete simulated payment', exact: true }).isVisible() || await page.getByRole('link', { name: /^View( your)? tickets$/ }).isVisible() || await page.locator('.buyer-wallet-row').count() === 3).toBe(true)
  if (await page.getByRole('button', { name: 'Complete simulated payment', exact: true }).isVisible()) await page.getByRole('button', { name: 'Complete simulated payment', exact: true }).click()
  const collectionUrl = await collection(page)
  const ids = dbJson<{ id: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id) order by created_at), '[]'::jsonb) from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(recipient)};`)
  const other = Object.entries(value.results).map(([, row]) => typeof row === 'object' && row && 'orderId' in row ? row.orderId : null)
  const candidates = ids.filter(row => !other.includes(row.id))
  if (candidates.length !== 1) throw new Error('Separate paid source has ambiguous canonical identity; no replacement purchase permitted')
  const result = { orderId: candidates[0].id, collectionUrl }
  value.results[key] = result; saveScenario(value)
  return result
}

test('J01 real signup, profile, deferred Connect, two-tier draft, publication and discovery', async ({ browser }) => journey('J01', async value => {
  const owner = await realContext(browser, 'organizer')
  const buyer = await realContext(browser, 'discovery')
  try {
    const users = dbJson<{ id: string; confirmed: boolean }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'confirmed',email_confirmed_at is not null)), '[]'::jsonb) from auth.users where email=${quote(value.organizerEmail)};`)
    if (!users.length) {
      await owner.page.goto(origin + '/auth/sign-up')
      await owner.page.getByLabel('Full name', { exact: true }).fill('Spec14 Organizer')
      await owner.page.getByLabel('Email', { exact: true }).fill(value.organizerEmail)
      await owner.page.getByLabel('Password', { exact: true }).fill(value.organizerPassword)
      await owner.page.getByRole('button', { name: 'Create account', exact: true }).click()
      await expect(owner.page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible()
      await confirmLocalSignup(owner.page, value.organizerEmail)
    } else if (!users[0].confirmed) await confirmLocalSignup(owner.page, value.organizerEmail)
    else await organizerLogin(owner.page, value)
    value.organizerId = dbJson<{ id: string }>(`select jsonb_build_object('id',id) from auth.users where email=${quote(value.organizerEmail)};`).id
    saveScenario(value)
    if (new URL(owner.page.url()).pathname === '/organizer/setup') {
      await owner.page.getByLabel('Organizer / business name', { exact: true }).fill('Spec14 Community ' + value.runId)
      await owner.page.getByLabel('Organizer type', { exact: true }).selectOption('Community group')
      await owner.page.getByRole('button', { name: 'Continue', exact: true }).click()
      await owner.page.getByRole('link', { name: 'Do this later', exact: true }).click()
      value.results.J01DeferredConnect = true; saveScenario(value)
    }
    // Synthetic provider policy is explicit before the real publication/worker path.
    await control({ action: 'moderation-mode', mode: 'approve' })
    value.paidEventId = await eventThroughUi(owner.page, value, 'paid', 'paid')
    saveScenario(value)
    await discover(buyer.page, value.paidEventId)
    const facts = dbJson<{ id: string; count: number }>(`select jsonb_build_object('id',e.id,'count',(select count(*) from public.ticket_tiers t where t.event_id=e.id)) from public.events e where e.id=${quote(value.paidEventId)};`)
    expect(facts.count).toBe(2)
    expect(owner.blocked).toEqual([]); expect(buyer.blocked).toEqual([])
    value.results.J01 = { outcome: 'passed-connected-core', eventId: facts.id, tierIds: value.events?.paid.tierIds, remaining: ['negative discovery controls'] }
  } finally { await owner.close(); await buyer.close() }
}))

test('J02 paid discovery to signed fulfillment, original collection, manual ticket 2 and QR duplicate', async ({ browser }) => journey('J02', async value => {
  const eventId = requireId(value.paidEventId, 'J01 paid event')
  const buyer = await realContext(browser, 'paid-buyer')
  const owner = await realContext(browser, 'organizer')
  try {
    if (!value.paidBuyerUrl) {
      const retained = value.results.paidCheckoutUrl
      if (typeof retained === 'string') await privateGoto(buyer.page, retained)
      else {
        await discover(buyer.page, eventId)
        const tickets = buyer.page.getByRole('link', { name: /Get tickets|Buy tickets/ }).first()
        await expect(tickets).toBeVisible()
        await tickets.click()
        await buyer.page.getByLabel('General Admission quantity', { exact: true }).fill('2')
        await buyer.page.getByLabel('VIP quantity', { exact: true }).fill('1')
        await continueToCheckout(buyer.page)
        value.results.paidCheckoutUrl = buyer.page.url(); saveScenario(value)
      }
      await expect.poll(async () => await buyer.page.getByLabel('Your name', { exact: true }).isVisible() || await buyer.page.getByRole('button', { name: 'Complete simulated payment', exact: true }).isVisible() || await buyer.page.getByRole('heading', { name: "You're all set", exact: true }).isVisible(), { message: 'Original checkout state is ready before choosing the next step' }).toBe(true)
      if (await buyer.page.getByLabel('Your name', { exact: true }).isVisible()) {
        await buyer.page.getByLabel('Your name', { exact: true }).fill('Paid Guest')
        await buyer.page.getByLabel('Email address', { exact: true }).fill(emailFor(value, 'paid'))
        await buyer.page.getByRole('button', { name: /Continue to secure payment|Retry same checkout/, exact: true }).click()
      }
      await expect.poll(async () => await buyer.page.getByRole('button', { name: 'Complete simulated payment', exact: true }).isVisible() || await buyer.page.getByRole('heading', { name: "You're all set", exact: true }).isVisible(), { message: 'Original checkout reaches hosted handoff or canonical confirmation' }).toBe(true)
      if (await buyer.page.getByRole('button', { name: 'Complete simulated payment', exact: true }).isVisible()) {
        value.results.paidHostedUrl = buyer.page.url(); saveScenario(value)
        await buyer.page.getByRole('button', { name: 'Complete simulated payment', exact: true }).click()
      }
      await expect(buyer.page.getByRole('heading', { name: "You're all set", exact: true })).toBeVisible()
      value.paidBuyerUrl = await collection(buyer.page); saveScenario(value)
    }
    const order = dbJson<{ id: string; items: number; quantity: number }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'items',(select count(*) from public.order_items i where i.order_id=o.id),'quantity',(select sum(quantity) from public.order_items i where i.order_id=o.id))), '[]'::jsonb) from public.orders o where o.event_id=${quote(eventId)} and o.buyer_email=${quote(emailFor(value, 'paid'))};`)
    expect(order.length).toBe(1); expect(order[0].items).toBe(2); expect(order[0].quantity).toBe(3)
    value.paidOrderId = order[0].id
    const before = ticketFacts(order[0].id)
    expect(before.length).toBe(3); value.paidTicketIds = before.map(ticket => ticket.id); saveScenario(value)
    if (!value.results.paidAllOriginalQrImages) {
      if (before.some(ticket => ticket.status !== 'valid')) throw new Error('All original paid QR proofs must be captured before admission; preserve the current history')
      const images: string[] = []
      for (let index = 0; index < 3; index++) images.push(await ticketQr(buyer.page, value.paidBuyerUrl, index))
      value.results.paidAllOriginalQrImages = images; saveScenario(value)
    }
    const qr = typeof value.results.paidQrImage === 'string' ? value.results.paidQrImage : await ticketQr(buyer.page, value.paidBuyerUrl, 1)
    const secondTicket = typeof value.results.paidQrSelector === 'string' ? value.results.paidQrSelector : new URL(buyer.page.url()).pathname.split('/').at(-1)!
    value.results.paidQrImage = qr; saveScenario(value)
    // The browser selector is opaque; canonical ticket membership comes from the collection's rendered data and server read.
    value.results.paidQrSelector = secondTicket
    await organizerLogin(owner.page, value)
    const selected = before.find(ticket => ticket.id === secondTicket)!
    expect(selected).toBeDefined()
    await manual(owner.page, eventId, order[0].id, selected.id, false)
    const after = ticketFacts(order[0].id)
    expect(after.filter(ticket => ticket.status === 'used')).toHaveLength(1)
    const usedAt = after.find(ticket => ticket.id === selected.id)!.usedAt
    await qrCamera(owner.page, qr)
    await owner.page.goto(origin + `/organizer/events/${eventId}/check-in/scan`)
    await expect(owner.page.getByRole('heading', { name: 'Already scanned', exact: true })).toBeVisible()
    expect(ticketFacts(order[0].id).find(ticket => ticket.id === selected.id)?.usedAt).toBe(usedAt)
    value.results.J02 = { outcome: 'passed-connected-core', orderId: order[0].id, ticketIds: value.paidTicketIds, selectedTicketId: selected.id, usedAt, remaining: ['QR-first/manual duplicate independent control', 'bounded admission race'] }
    expect(buyer.blocked).toEqual([]); expect(owner.blocked).toEqual([])
  } finally { await buyer.close(); await owner.close() }
}))

test('J03 free UI event, three admissions, ticket 2 manual and QR duplicate without paid calls', async ({ browser }) => journey('J03', async value => {
  const owner = await realContext(browser, 'organizer')
  const buyer = await realContext(browser, 'free-buyer')
  const paidCalls: string[] = []
  const paidCardReads: string[] = []
  const paidRpcNames = new Set(['list_owned_ticket_tiers', 'save_ticket_tiers', 'activate_paid_sales', 'get_organizer_event_metrics', 'get_organizer_order', 'get_organizer_order_v2', 'list_organizer_event_orders_filtered', 'list_organizer_event_admissions'])
  const monitorPaidCalls = (request: Request) => {
    if (isOriginalPaidCardRead(request, value)) { paidCardReads.push('original-paid-event-card'); return }
    const pathname = new URL(request.url()).pathname
    const name = pathname.split('/').at(-1) ?? ''
    if (name.startsWith('stripe-') || name === 'organizer-refund-order' || name === 'ticket_tiers' || paidRpcNames.has(name)) paidCalls.push(pathname)
  }
  for (const context of [owner.context, buyer.context]) context.on('request', monitorPaidCalls)
  try {
    await organizerLogin(owner.page, value)
    value.freeEventId = await eventThroughUi(owner.page, value, 'free', 'free'); saveScenario(value)
    if (!value.freeBuyerUrl) {
      await discover(buyer.page, value.freeEventId)
      await buyer.page.getByRole('link', { name: /RSVP/ }).click()
      await expect.poll(async () => await buyer.page.getByRole('button', { name: 'Increase quantity', exact: true }).isVisible() || await buyer.page.getByRole('link', { name: /^View( your)? tickets$/ }).isVisible() || await buyer.page.getByRole('button', { name: /Check.*RSVP|Check status/ }).isVisible(), { message: 'RSVP initial or retained canonical state is ready' }).toBe(true)
      const retained = await buyer.page.getByRole('button', { name: /Check.*RSVP|Check status/ }).isVisible()
      if (retained) {
        await buyer.page.getByRole('button', { name: /Check.*RSVP|Check status/ }).click()
        await expect(buyer.page.getByRole('link', { name: /^View( your)? tickets$/ })).toBeVisible()
      }
      if (!await buyer.page.getByRole('link', { name: /^View( your)? tickets$/ }).isVisible()) {
      await buyer.page.getByRole('button', { name: 'Increase quantity', exact: true }).click({ clickCount: 2 })
      await buyer.page.getByRole('button', { name: 'Continue', exact: true }).click()
      await buyer.page.getByLabel('Full name', { exact: true }).fill('Free Guest')
      await buyer.page.getByLabel('Email address', { exact: true }).fill(emailFor(value, 'free'))
      await buyer.page.getByRole('button', { name: 'Confirm RSVP', exact: true }).click()
      }
      await expect(buyer.page.getByRole('link', { name: /^View( your)? tickets$/ })).toBeVisible()
      value.freeBuyerUrl = await collection(buyer.page); saveScenario(value)
    }
    const rows = dbJson<{ id: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id)), '[]'::jsonb) from public.free_registrations where event_id=${quote(value.freeEventId)} and email=${quote(emailFor(value, 'free'))};`)
    expect(rows.length).toBe(1); value.freeRegistrationId = rows[0].id
    const before = ticketFacts(rows[0].id, true)
    expect(before.length).toBe(3); value.freeTicketIds = before.map(ticket => ticket.id); saveScenario(value)
    const qr = typeof value.results.freeQrImage === 'string' ? value.results.freeQrImage : await ticketQr(buyer.page, value.freeBuyerUrl, 1)
    value.results.freeQrImage = qr; saveScenario(value)
    await manual(owner.page, value.freeEventId, rows[0].id, before[1].id, true)
    const after = ticketFacts(rows[0].id, true)
    expect(after[0]).toEqual(before[0]); expect(after[2]).toEqual(before[2])
    expect(after[1].status).toBe('used'); expect(after[1].credentialHash).toBe(before[1].credentialHash)
    await qrCamera(owner.page, qr)
    await owner.page.goto(origin + `/organizer/events/${value.freeEventId}/check-in/scan`)
    await expect(owner.page.getByRole('heading', { name: 'Already scanned', exact: true })).toBeVisible()
    expect(ticketFacts(rows[0].id, true)).toEqual(after)
    const reverse = await realContext(browser, 'free-reverse-buyer')
    reverse.context.on('request', monitorPaidCalls)
    try {
      let reverseUrl = value.results.freeReverseBuyerUrl
      if (typeof reverseUrl !== 'string') {
        await discover(reverse.page, value.freeEventId)
        await reverse.page.getByRole('link', { name: /RSVP/ }).click()
        await expect.poll(async () => await reverse.page.getByRole('button', { name: 'Increase quantity', exact: true }).isVisible() || await reverse.page.getByRole('button', { name: 'Check RSVP status', exact: true }).isVisible() || await reverse.page.getByRole('link', { name: /^View( your)? tickets$/ }).isVisible()).toBe(true)
        if (await reverse.page.getByRole('button', { name: 'Check RSVP status', exact: true }).isVisible()) await reverse.page.getByRole('button', { name: 'Check RSVP status', exact: true }).click()
        if (await reverse.page.getByRole('button', { name: 'Increase quantity', exact: true }).isVisible()) {
        await reverse.page.getByRole('button', { name: 'Increase quantity', exact: true }).click({ clickCount: 2 })
        await reverse.page.getByRole('button', { name: 'Continue', exact: true }).click()
        await reverse.page.getByLabel('Full name', { exact: true }).fill('Free Guest Reverse')
        await reverse.page.getByLabel('Email address', { exact: true }).fill(emailFor(value, 'free-reverse'))
        await reverse.page.getByRole('button', { name: 'Confirm RSVP', exact: true }).click()
        }
        reverseUrl = await collection(reverse.page)
        value.results.freeReverseBuyerUrl = reverseUrl; saveScenario(value)
      }
      const reverseRows = dbJson<{ id: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id)), '[]'::jsonb) from public.free_registrations where event_id=${quote(value.freeEventId)} and email=${quote(emailFor(value, 'free-reverse'))};`)
      expect(reverseRows.length).toBe(1)
      const reverseId = reverseRows[0].id
      const reverseBefore = ticketFacts(reverseId, true)
      const reverseQr = typeof value.results.freeReverseQrImage === 'string' ? value.results.freeReverseQrImage : await ticketQr(reverse.page, reverseUrl as string, 1)
      value.results.freeReverseQrImage = reverseQr; saveScenario(value)
      const scanPage = await owner.context.newPage()
      await qrCamera(scanPage, reverseQr)
      await scanPage.goto(origin + `/organizer/events/${value.freeEventId}/check-in/scan`)
      await expect(scanPage.getByRole('heading', { name: /^(Admitted|Already scanned)$/ })).toBeVisible()
      const reverseAfter = ticketFacts(reverseId, true)
      expect(reverseAfter[1].status).toBe('used')
      expect(reverseAfter[0]).toEqual(reverseBefore[0]); expect(reverseAfter[2]).toEqual(reverseBefore[2])
      await manual(scanPage, value.freeEventId, reverseId, reverseBefore[1].id, true)
      await expect(scanPage.getByRole('heading', { name: 'Already checked in', exact: true })).toBeVisible()
      expect(ticketFacts(reverseId, true)).toEqual(reverseAfter)
      value.results.freeReverse = { registrationId: reverseId, ticketIds: reverseAfter.map(ticket => ticket.id), usedAt: reverseAfter[1].usedAt }
      await scanPage.close()
    } finally { await reverse.close() }
    expect(paidCalls).toEqual([])
    value.results.J03 = { outcome: 'passed-connected-core', registrationId: rows[0].id, ticketIds: value.freeTicketIds, selectedTicketId: before[1].id, usedAt: after[1].usedAt, paidCalls, paidCardReads, monitoredPaidRpcNames: [...paidRpcNames], remaining: ['real owner/source denial and bounded race matrix are root-owned'] }
  } finally { await owner.close(); await buyer.close() }
}))

type Inbox = { messages: { providerId: string; mode: string; payload: { to: string[] | string; html?: string; text?: string } }[] }
const inbox = () => control<Inbox>({ action: 'inbox' })
function messageLink(message: Inbox['messages'][number]) {
  const html = (message.payload.html ?? '') + '\n' + (message.payload.text ?? '')
  const url = html.match(/http:\/\/127\.0\.0\.1:3040\/(?:ticket-access|ticket-email-access|email-tickets|tickets\/access|refund-details|event-status)[^\s"<>]+/)?.[0].replaceAll('&amp;', '&')
  if (!url) throw new Error('Captured local delivery has no recognized scoped application link')
  return url
}

type OutboxRow = { id: string; purpose: string; order_id: string | null; registration_id: string | null; request_id: string | null; state: string; provider_id: string | null; dispatch_count: number; first_possible_dispatch_at: string | null; accepted_at: string | null }
const outboxRows = (where: string) => dbJson<OutboxRow[]>(`select coalesce(jsonb_agg(to_jsonb(o) order by created_at,id),'[]'::jsonb) from private.ticket_email_outbox o where ${where};`)
function privateEqual(actual:unknown,expected:unknown,label:string) { expect(JSON.stringify(actual)===JSON.stringify(expected),label).toBe(true) }
type GuardRow = EmailQueueRow & { [key:string]:unknown; purpose:string; order_id:string|null; request_id:string|null; grant_id:string|null }
type EmailGuardSnapshot = { capturedAt:string; outboxes:GuardRow[]; grants:Record<string,unknown>[]; members:Record<string,unknown>[]; receipts:{order_id:string}[]; candidates:string[]; tables:unknown; claimHash:string; enqueueHash:string }
function emailGuardSnapshot():EmailGuardSnapshot {
  const tables=dbJson<{schema:string;name:string}[]>(`select coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'name',tablename) order by schemaname,tablename),'[]'::jsonb) from pg_tables where schemaname in ('public','private') and tablename<>'spatial_ref_sys';`)
  const hashes=tables.filter(t=>!(t.schema==='private'&&['ticket_email_outbox','ticket_email_grants','ticket_email_members','refund_notice_receipts'].includes(t.name))).map(t=>{
    if(!/^[a-z_][a-z0-9_]*$/.test(t.schema)||!/^[a-z_][a-z0-9_]*$/.test(t.name))throw new Error('Unexpected email preservation table')
    return `select '${t.schema}.${t.name}' name,count(*) rows,encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'sha256'),'hex') sha256 from ${t.schema}.${t.name} t`
  })
  return dbJson<EmailGuardSnapshot>(`select jsonb_build_object('capturedAt',clock_timestamp(),'outboxes',(select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]'::jsonb) from private.ticket_email_outbox o),'grants',(select coalesce(jsonb_agg(to_jsonb(g) order by id),'[]'::jsonb) from private.ticket_email_grants g),'members',(select coalesce(jsonb_agg(to_jsonb(m) order by grant_id,position),'[]'::jsonb) from private.ticket_email_members m),'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by order_id),'[]'::jsonb) from private.refund_notice_receipts r),'candidates',(select coalesce(jsonb_agg(o.id order by o.id),'[]'::jsonb) from public.orders o where o.status='refunded' and not exists(select 1 from private.refund_notice_receipts r where r.order_id=o.id)),'tables',(select jsonb_agg(h order by name) from (${hashes.join(' union all ')}) h),'claimHash',encode(extensions.digest(pg_get_functiondef('public.server_claim_ticket_email()'::regprocedure),'sha256'),'hex'),'enqueueHash',encode(extensions.digest(pg_get_functiondef('public.server_enqueue_refund_notices(integer)'::regprocedure),'sha256'),'hex'));`)
}
function emailProofHashes():EmailProofHashes {
  const paths={spec:new URL('./spec14.spec.ts',import.meta.url),guard:new URL('./support/spec14EmailGuard.ts',import.meta.url),harness:new URL('./support/spec14Harness.ts',import.meta.url)}
  return Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,createHash('sha256').update(readFileSync(path)).digest('hex')]))
}
// One explicitly reviewed historical receipt, never a general old-source allowlist.
function verifyProcessingInitialReceiptHistory(value:Scenario,key:string,row:OutboxRow|GuardRow,current:EmailProofHashes) {
  const originalSha='4eecf68ee93670be95667823cc1468ecc165b6713ab525913401591f385ec749'
  const originalHashes={spec:'8d729e92044dcdadd1ba71ee08b038302c594a60a1237f08fff914152ca7dfc3',guard:'61e756e43f4b082b45eb28c0770314f5fa9ed12d77824ffa10980275def6de1c',harness:'1a437e86ccfa81f4efe7f74762bc206ed42828a8eb1df855e711b5c63283aedf'}
  const privatePath=(name:string)=>new URL('../../.superpowers/spec14/'+name,import.meta.url)
  const readBound=(name:string,sha?:string)=>{
    const path=privatePath(name)
    if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw new Error('Historical receipt binding is not a regular file')
    const bytes=readFileSync(path)
    if(sha&&createHash('sha256').update(bytes).digest('hex')!==sha)throw new Error('Historical receipt evidence hash differs')
    return bytes
  }
  const bindingBytes=readBound('terminal-j05-processing-readback-binding.json')
  const digest=z.string().regex(/^[a-f0-9]{64}$/)
  const binding=z.object({scope:z.literal('J05-processing-original-initial-receipt-only'),originalScenarioSha256:z.literal(originalSha),currentSpecSha256:digest,currentSourceSha256:digest,currentAssetsSha256:digest,originalProofReviewSha256:digest}).strict().parse(JSON.parse(bindingBytes.toString()))
  readBound('terminal-j05-processing-readback-independent-review.md',binding.originalProofReviewSha256)
  const build=JSON.parse(readBound('build-identity.json').toString()) as {sourceSha256:string;assetsSha256:string}
  privateEqual(current,{...originalHashes,spec:binding.currentSpecSha256},'Historical receipt current source/helper binding differs')
  privateEqual(build.sourceSha256,binding.currentSourceSha256,'Historical receipt build source differs')
  privateEqual(build.assetsSha256,binding.currentAssetsSha256,'Historical receipt build assets differ')
  readBound('source-archives/'+originalHashes.spec+'-spec14.spec.ts',originalHashes.spec)
  const original=JSON.parse(readBound('source-archives/'+originalSha+'-scenario.json',originalSha).toString()) as Scenario
  const originalSteps=original.results[key] as Parameters<typeof assertCompletedEmailWorker>[0]
  if(key!=='refundInitialReceiptWorker-processing'||row.state!=='accepted'||originalSteps?.length!==1)throw new Error('Historical receipt target or proof count differs')
  privateEqual(value.results[key],originalSteps,'Original completed worker proof changed')
  privateEqual(value.results['refundSource-processing'],original.results['refundSource-processing'],'Historical receipt original paid source differs')
  const step=originalSteps[0] as {after:{outboxes:GuardRow[]};providerAfter:{email:{mode:string;messages:{providerId:string;mode:string}[]}}}
  const target=step.after.outboxes.filter(item=>item.id===row.id)
  if(target.length!==1||row.purpose!=='initial'||row.order_id!==(original.results['refundSource-processing'] as {orderId:string}).orderId)throw new Error('Historical receipt source or purpose differs')
  privateEqual(row,target[0],'Historical receipt canonical row changed')
  const provider=JSON.parse(readBound('provider-state.json').toString()) as typeof step.providerAfter
  if(provider.email.mode!=='accepted'||step.providerAfter.email.mode!=='accepted')throw new Error('Historical receipt provider mode differs')
  const priorMessage=step.providerAfter.email.messages.filter(message=>message.providerId===row.provider_id)
  const currentMessage=provider.email.messages.filter(message=>message.providerId===row.provider_id)
  if(priorMessage.length!==1||currentMessage.length!==1||priorMessage[0].mode!=='accepted')throw new Error('Historical receipt provider identity differs')
  privateEqual(currentMessage,priorMessage,'Historical receipt original provider message changed')
  assertCompletedEmailWorker(originalSteps,row.id,'accepted',originalHashes,true)
  // Record readback separately; never rewrite or manufacture a worker completion.
  const readbacks=(value.results['refundInitialReceiptWorker-processingHistoricalReadbacks']??=[]) as unknown[]
  readbacks.push({kind:'historical-readback',outboxId:row.id,sourceOrderId:row.order_id,originalScenarioSha256:originalSha,originalToolHashes:originalHashes,currentToolHashes:current,bindingSha256:createHash('sha256').update(bindingBytes).digest('hex'),reviewSha256:binding.originalProofReviewSha256,readAt:new Date().toISOString()})
  saveScenario(value)
}
function verifyEmailReadback(value:Scenario,key:string,row:OutboxRow|GuardRow,required=false) {
  const current=emailProofHashes()
  const retained=value.results[key] as Parameters<typeof assertCompletedEmailWorker>[0]
  const previous=retained?.at(-1)
  if(key==='refundInitialReceiptWorker-processing'&&previous?.status==='completed'&&previous.completion?.toolHashes?.spec==='8d729e92044dcdadd1ba71ee08b038302c594a60a1237f08fff914152ca7dfc3'&&current.spec!=='8d729e92044dcdadd1ba71ee08b038302c594a60a1237f08fff914152ca7dfc3') {
    verifyProcessingInitialReceiptHistory(value,key,row,current)
    return
  }
  assertCompletedEmailWorker(value.results[key] as Parameters<typeof assertCompletedEmailWorker>[0],row.id,row.state,current,required)
}
async function exactEmailWorker(value:Scenario,key:string,target:EmailWorkerTarget,mode:'accepted'|'failed') {
  const before=emailGuardSnapshot()
  const preflights=(value.results[key+'Preflights']??=[]) as unknown[]
  preflights.push({target,mode,before,capturedAt:new Date().toISOString()});saveScenario(value)
  expect(before.claimHash).toBe('0c5be9b2c58ce91416b02f429c235a66e6ea9c890db0b7d4c2cee61c7a6cb5e1')
  expect(before.enqueueHash).toBe('400978e1452d56325f60eeb2e4e107647e1118fa5f9f63d80ba64c6ea9873def')
  // Refuse all outside live intents, including future due/leased rows; no timing assumption.
  assertEmailWorkerPlan(before.outboxes,before.candidates,target)
  const providerBefore=await control<{stripe:unknown;moderation:unknown;email:{mode:string;messages:unknown[]}}>({action:'state'})
  expect(providerBefore.email.mode).toBe('accepted')
  const steps=(value.results[key]??=[]) as Record<string,unknown>[]
  const step:Record<string,unknown>={status:'running',toolHashes:emailProofHashes(),target,mode,before,providerBefore,startedAt:new Date().toISOString(),controlHttpStatus:null,response:null,after:null}
  steps.push(step);saveScenario(value)
  try {
  let workerError:unknown
  try {
    await control({action:'email-mode',mode})
    // Mode changes cannot authorize changed application rows between inspection and invocation.
    const recheck=emailGuardSnapshot();privateEqual(recheck.outboxes,before.outboxes,'Email queue changed after preflight');privateEqual(recheck.candidates,before.candidates,'Refund candidate set changed after preflight')
    assertEmailWorkerPlan(recheck.outboxes,recheck.candidates,target)
    step.response=await control({action:'run-worker',name:'ticket-email-worker'});saveScenario(value)
  } catch(error) {workerError=error;step.errorName=error instanceof Error?error.name:'Unknown';saveScenario(value)} finally {
    await control({action:'email-mode',mode:'accepted'})
    step.finishedAt=new Date().toISOString();step.after=emailGuardSnapshot();saveScenario(value)
  }
  const after=step.after as EmailGuardSnapshot
  const matches=(r:GuardRow)=>target.outboxId ? r.id===target.outboxId : r.purpose==='refund_notice'&&r.order_id===target.refundOrderId
  const targets=after.outboxes.filter(matches);expect(targets).toHaveLength(1)
  privateEqual(after.outboxes.filter(r=>!matches(r)),before.outboxes.filter(r=>!matches(r)),'Outside email rows changed')
  privateEqual(after.tables,before.tables,'Outside business/history table hashes changed')
  const grant=targets[0].grant_id
  privateEqual(after.grants.filter(g=>g.id!==grant),before.grants.filter(g=>g.id!==grant),'Outside grants changed')
  for(const old of before.grants)expect(after.grants.some(row=>JSON.stringify(row)===JSON.stringify(old)),'Existing grant changed').toBe(true)
  for(const old of before.members)expect(after.members.some(row=>JSON.stringify(row)===JSON.stringify(old)),'Existing membership changed').toBe(true)
  privateEqual(after.members.filter(m=>m.grant_id!==grant),before.members.filter(m=>m.grant_id!==grant),'Outside membership changed')
  privateEqual(after.receipts.filter(r=>r.order_id!==target.refundOrderId),before.receipts.filter(r=>r.order_id!==target.refundOrderId),'Outside notice receipts changed')
  const providerAfter=await control<typeof providerBefore>({action:'state'});step.providerAfter=providerAfter;saveScenario(value)
  privateEqual(providerAfter.stripe,providerBefore.stripe,'Stripe provider state changed during email worker');privateEqual(providerAfter.moderation,providerBefore.moderation,'Moderation state changed during email worker')
  privateEqual(providerAfter.email.messages.slice(0,providerBefore.email.messages.length),providerBefore.email.messages,'Existing provider inbox changed')
  expect(providerAfter.email.messages.length-providerBefore.email.messages.length).toBeLessThanOrEqual(1)
  expect(providerAfter.email.mode).toBe('accepted')
  if(workerError)throw workerError
  expect((step.response as {handlerStatus?:number}|null)?.handlerStatus).toBe(200)
  privateEqual(emailProofHashes(),step.toolHashes,'Worker proof source/helper changed during execution')
  step.completion={outboxId:targets[0].id,state:targets[0].state,toolHashes:step.toolHashes,completedAt:new Date().toISOString()}
  step.status='completed';saveScenario(value)
  return targets[0]
  } catch(error) {
    step.status='failed';step.failureName=error instanceof Error?error.name:'Unknown';saveScenario(value);throw error
  }
}
async function exactRefundNotice(value:Scenario,key:string,orderId:string,mode:'accepted'|'failed') {
  const existing=outboxRows(`purpose='refund_notice' and order_id=${quote(orderId)}`)
  expect(existing.length).toBeLessThanOrEqual(1)
  if(existing[0]?.state===mode) {
    verifyEmailReadback(value,key,existing[0],mode==='failed')
    return existing[0]
  }
  const row=await exactEmailWorker(value,key,existing[0]?{outboxId:existing[0].id}:{refundOrderId:orderId},mode)
  expect(row.state).toBe(mode);expect(row.dispatch_count).toBe(1)
  return row
}
async function exactRecoveryRequest(page:Page,value:Scenario,key:string,recipient:string) {
  type Retained={requestId:string;outboxId?:string;acknowledged?:boolean}
  let retained=value.results[key] as Retained|undefined
  let creates=0
  const resumed=!!retained
  if(retained) {
    await page.route('**/functions/v1/ticket-recovery-request',route=>{creates++;return route.abort('blockedbyclient')})
    await page.goto(origin+'/tickets/recover')
    const actual=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('wheretoo:ticket-recovery:v1')??'{}') as {requestId?:string;email?:string})
    privateEqual(actual.requestId,retained.requestId,'Restored recovery request differs');privateEqual(actual.email,recipient,'Restored recovery recipient differs')
  } else {
    await page.goto(origin+'/tickets/recover')
    await page.getByLabel('Email address',{exact:true}).fill(recipient)
    await page.route('**/functions/v1/ticket-recovery-request',async route=>{
      const body=route.request().postDataJSON() as {requestId:string;email:string}
      privateEqual(body.email,recipient,'Recovery recipient differs before request');requireId(body.requestId,'Actual recovery request')
      if(retained&&retained.requestId!==body.requestId)throw new Error('Recovery request changed before acknowledgement')
      retained={requestId:body.requestId};value.results[key]=retained;saveScenario(value);creates++;await route.continue()
    },{times:1})
    await page.getByRole('button',{name:'Send me my tickets',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Check your email',exact:true})).toBeVisible()
    retained=value.results[key] as Retained|undefined
    if(!retained)throw new Error('No actual recovery request was recorded')
    retained.acknowledged=true;saveScenario(value)
  }
  const rows=outboxRows(`purpose='recovery' and request_id=${quote(retained.requestId)}`);expect(rows).toHaveLength(1)
  if(retained.outboxId)privateEqual(rows[0].id,retained.outboxId,'Recovery outbox differs')
  retained.outboxId=rows[0].id;value.results[key]=retained;saveScenario(value)
  expect(creates).toBe(resumed?0:1)
  return rows[0]
}
async function acceptedMessage(row: OutboxRow) {
  expect(row.state).toBe('accepted'); expect(row.dispatch_count).toBe(1)
  expect(row.provider_id).toBeTruthy(); expect(row.accepted_at).toBeTruthy(); expect(row.first_possible_dispatch_at).toBeTruthy()
  const messages = (await inbox()).messages.filter(message => message.providerId === row.provider_id)
  expect(messages).toHaveLength(1)
  return messages[0]
}
async function acceptedRecoveryDelivery(page: Page) {
  const requestId = requireId(await page.evaluate(() => JSON.parse(sessionStorage.getItem('wheretoo:ticket-recovery:v1') ?? '{}').requestId as string | undefined), 'Retained recovery request')
  const rows = outboxRows(`purpose='recovery' and request_id=${quote(requestId)}`)
  expect(rows).toHaveLength(1)
  return { requestId, outboxId: rows[0].id, providerId: rows[0].provider_id, url: messageLink(await acceptedMessage(rows[0])) }
}
async function expectWalletFacts(page: Page, facts: ReturnType<typeof ticketFacts>) {
  await expect(page.locator('.buyer-wallet-row')).toHaveCount(facts.length)
  const rendered = await page.locator('.buyer-wallet-row').evaluateAll(rows => rows.map(row => {
    const url = new URL((row as HTMLAnchorElement).href)
    return { id: url.searchParams.get('ticket') ?? url.pathname.split('/').at(-1), status: row.querySelector('.buyer-status')?.textContent?.trim().toLowerCase() }
  }))
  expect(rendered.sort((a,b) => String(a.id).localeCompare(String(b.id)))).toEqual(facts.map(ticket => ({id:ticket.id,status:ticket.status === 'used' ? 'already used' : ticket.status})).sort((a,b) => a.id.localeCompare(b.id)))
}

test('J04 initial receipts, no mount sends, real worker transport and neutral recovery in fresh context', async ({ browser }) => journey('J04', async value => {
  const orderId = requireId(value.paidOrderId, 'J02 paid order')
  const registrationId = requireId(value.freeRegistrationId, 'J03 free registration')
  const buyer = await realContext(browser, 'recovery-buyer')
  const where = `purpose='initial' and (order_id=${quote(orderId)} or registration_id=${quote(registrationId)})`
  try {
    const receipts = dbJson<{ paid: number; free: number }>(`select jsonb_build_object('paid',(select count(*) from private.ticket_email_initial_receipts where order_id=${quote(orderId)}),'free',(select count(*) from private.ticket_email_initial_receipts where registration_id=${quote(registrationId)}));`)
    expect(receipts).toEqual({ paid: 1, free: 1 })
    const initialBefore = outboxRows(where)
    expect(initialBefore).toHaveLength(2)
    if (!value.results.J04InitialBaseline) {
      for (const row of initialBefore) expect(row).toMatchObject({state:'queued',provider_id:null,dispatch_count:0,first_possible_dispatch_at:null,accepted_at:null})
      value.results.J04InitialBaseline = initialBefore; saveScenario(value)
    }
    expect(initialBefore.map(row => row.id)).toEqual((value.results.J04InitialBaseline as OutboxRow[]).map(row => row.id))
    const beforeMessages = (await inbox()).messages.length
    for (const [url, facts] of [[value.paidBuyerUrl!, ticketFacts(orderId)], [value.freeBuyerUrl!, ticketFacts(registrationId,true)]] as const) {
      await privateGoto(buyer.page,url); await expectWalletFacts(buyer.page,facts)
      await buyer.page.reload(); await expectWalletFacts(buyer.page,facts)
    }
    expect(outboxRows(where)).toEqual(initialBefore)
    expect((await inbox()).messages.length).toBe(beforeMessages)
    await control({action:'email-mode',mode:'accepted'})
    await control({action:'run-worker',name:'ticket-email-worker'})
    const delivered = outboxRows(where)
    expect(delivered.map(row=>row.id)).toEqual(initialBefore.map(row=>row.id))
    for (const row of delivered) {
      const message = await acceptedMessage(row)
      const url = messageLink(message)
      const free = row.registration_id !== null
      const fresh = await realContext(browser, free ? 'initial-free-email' : 'initial-paid-email')
      try { await privateGoto(fresh.page,url); await expectWalletFacts(fresh.page,ticketFacts(free ? registrationId : orderId,free)) }
      finally {await fresh.close()}
    }
    await buyer.page.goto(origin+'/tickets/recover')
    const emailField=buyer.page.getByLabel('Email address',{exact:true})
    if(await emailField.isEditable()) await emailField.fill(emailFor(value,'free'))
    else await expect(emailField).toHaveValue(emailFor(value,'free'))
    await buyer.page.getByRole('button',{name:/^(Send me my tickets|Try again)$/}).click()
    await expect(buyer.page.getByRole('heading',{name:'Check your email',exact:true})).toBeVisible()
    const requestId = await buyer.page.evaluate(() => JSON.parse(sessionStorage.getItem('wheretoo:ticket-recovery:v1') ?? '{}').requestId as string | undefined)
    requireId(requestId,'Original recovery request')
    value.results.J04RecoveryRequestId=requestId;saveScenario(value)
    await control({action:'run-worker',name:'ticket-email-worker'})
    const recoveryRows = outboxRows(`purpose='recovery' and request_id=${quote(requestId!)}`)
    expect(recoveryRows).toHaveLength(1)
    const url = messageLink(await acceptedMessage(recoveryRows[0]))
    value.results.freeRecoveryUrl=url;saveScenario(value)
    const freshRecovery=await realContext(browser,'original-free-recovery-email')
    try {await privateGoto(freshRecovery.page,url);await expectWalletFacts(freshRecovery.page,ticketFacts(registrationId,true))}
    finally {await freshRecovery.close()}
    value.results.J04={outcome:'passed-connected-core',receipts,initialOutboxIds:delivered.map(row=>row.id),initialProviderIds:delivered.map(row=>row.provider_id),recoveryRequestId:requestId,recoveryOutboxId:recoveryRows[0].id,recoveryProviderId:recoveryRows[0].provider_id,remaining:['supplemental failure/scope controls tracked separately']}
  } finally {await buyer.close()}
}))

type RefundOrder = Database['public']['Tables']['orders']['Row']
type RefundItem = Database['public']['Tables']['order_items']['Row']
type RefundOperation = { id:string; order_id:string; idempotency_key:string; snapshot:Record<string,unknown>; requested_at:string; first_possible_dispatch_at:string; state:string; stripe_refund_id:string|null; completed_at:string|null }
type FinancialSnapshot = { order:RefundOrder; items:RefundItem[]; tickets:Database['public']['Tables']['tickets']['Row'][]; operations:RefundOperation[]; refunds:Database['public']['Tables']['refunds']['Row'][] }
const financialSnapshot = (orderId:string) => dbJson<FinancialSnapshot>(`select jsonb_build_object('order',to_jsonb(o),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.order_items i where i.order_id=o.id),'tickets',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.tickets t where t.order_id=o.id),'operations',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from private.order_refund_operations p where p.order_id=o.id),'refunds',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.refunds r where r.order_id=o.id)) from public.orders o where o.id=${quote(orderId)};`)
const expectedRefundSnapshot = (order:RefundOrder) => ({orderId:order.id,paymentIntentId:order.stripe_payment_intent_id,chargeId:order.stripe_charge_id,transferId:order.stripe_transfer_id,applicationFeeId:order.stripe_application_fee_id,connectedAccountId:order.stripe_destination_account_id,totalMinor:order.total_minor,applicationFeeAmountMinor:order.application_fee_amount_minor,currency:order.currency,reason:'requested_by_customer'})
const immutableOriginalOrder = (order:RefundOrder) => Object.fromEntries(Object.entries(order).filter(([key])=>!['status','refunded_at','reconciliation_status','failure_code','last_stripe_event_id','updated_at'].includes(key)))
const immutableOperation = (operation:RefundOperation) => ({id:operation.id,orderId:operation.order_id,key:operation.idempotency_key,snapshot:operation.snapshot,requestedAt:operation.requested_at,dispatchAnchor:operation.first_possible_dispatch_at})
// A distinct signed receipt legitimately updates only the order audit pointer/time.
const financialFactsWithoutReceiptAudit = (snapshot:FinancialSnapshot) => ({...snapshot,order:Object.fromEntries(Object.entries(snapshot.order).filter(([key])=>key!=='last_stripe_event_id' && key!=='updated_at'))})
async function ownerMetrics(page:Page,eventId:string) {
  const dashboardUrl=origin+`/organizer/events/${eventId}/dashboard`
  const requests=new Set<Request>()
  let committed=false,captured=false
  let resolveMetrics!:(value:EventMetrics)=>void,rejectMetrics!:(error:unknown)=>void
  const metrics=new Promise<EventMetrics>((resolve,reject)=>{resolveMetrics=resolve;rejectMetrics=reject})
  const timeout=setTimeout(()=>rejectMetrics(new Error('Actual owner metrics read timed out')),40_000)
  // The outgoing My Events cards issue this same RPC. Only requests made after
  // our dashboard commit belong to this read, even if old responses arrive later.
  const onNavigation=(frame:Frame)=>{if(frame===page.mainFrame())committed=frame.url()===dashboardUrl}
  const onRequest=(request:Request)=>{
    if(!committed||request.frame()!==page.mainFrame()||request.method()!=='POST')return
    const url=new URL(request.url())
    if(url.origin===origin&&url.pathname==='/rest/v1/rpc/get_organizer_event_metrics'&&request.postDataJSON()?.p_event_id===eventId)requests.add(request)
  }
  const onResponse=(response:Response)=>{
    if(captured||!requests.has(response.request()))return
    captured=true
    if(!response.ok()){rejectMetrics(new Error('Actual owner metrics read failed'));return}
    // Start body capture now; waiting for goto's load can invalidate this body.
    void response.json().then(resolveMetrics,rejectMetrics)
  }
  page.on('framenavigated',onNavigation);page.on('request',onRequest);page.on('response',onResponse)
  try {
    // Attach both rejection handlers before initiating navigation.
    const [result]=await Promise.all([metrics,Promise.resolve().then(()=>page.goto(dashboardUrl))])
    return result
  } finally {
    clearTimeout(timeout)
    page.off('framenavigated',onNavigation);page.off('request',onRequest);page.off('response',onResponse)
  }
}
// Observation may attach existing provider evidence, but never authorizes another financial dispatch.
function expectRefundObservationPreservation(before:FinancialSnapshot,after:FinancialSnapshot) {
  expect(after.order).toEqual(before.order)
  expect(after.items).toEqual(before.items)
  expect(after.tickets).toEqual(before.tickets)
  expect(after.refunds).toEqual(before.refunds)
  expect(before.operations).toHaveLength(1);expect(after.operations).toHaveLength(1)
  expect(immutableOperation(after.operations[0])).toEqual(immutableOperation(before.operations[0]))
  const stable=(operation:RefundOperation)=>Object.fromEntries(Object.entries(operation).filter(([key])=>!['state','stripe_refund_id','updated_at'].includes(key)))
  expect(stable(after.operations[0])).toEqual(stable(before.operations[0]))
}
async function checkExistingRefund(page:Page,eventId:string,orderId:string,outcome:string) {
  const response=page.waitForResponse(response=>{
    if(new URL(response.url()).pathname!=='/functions/v1/organizer-refund-order')return false
    const body=response.request().postDataJSON() as {eventId?:string;orderId?:string;action?:string}
    return body.eventId===eventId&&body.orderId===orderId&&body.action==='reconcile'
  })
  await page.getByRole('button',{name:'Check existing refund',exact:true}).click()
  const actual=await response
  expect(actual.status()).toBe(200)
  expect(await actual.json()).toEqual({outcome})
}
const displayMoney=(minor:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:minor%100?2:0}).format(minor/100)

test('J05 full paid refund uses original operation, signed refund webhook and stable Used history', async ({ browser }) => journey('J05', async value => {
  const eventId=requireId(value.paidEventId,'Paid event'),orderId=requireId(value.paidOrderId,'Paid order')
  const owner=await realContext(browser,'organizer'),buyer=await realContext(browser,'paid-buyer')
  try {
    await organizerLogin(owner.page,value)
    type Baseline={finance:FinancialSnapshot;tickets:ReturnType<typeof ticketFacts>;metrics:EventMetrics;providerRefundIds:string[]}
    let baseline=value.results.J05OriginalSnapshot as Baseline|undefined
    if(!baseline) {
      const finance=financialSnapshot(orderId)
      if(finance.operations.length) throw new Error('Original refund baseline was not retained before dispatch; do not reconstruct a pre-refund snapshot')
      baseline={finance,tickets:ticketFacts(orderId),metrics:await ownerMetrics(owner.page,eventId),providerRefundIds:(await control<{stripe:{refundIds:string[]}}>({action:'state'})).stripe.refundIds}
      value.results.J05OriginalSnapshot=baseline;saveScenario(value)
    }
    const before=baseline.tickets
    await owner.page.goto(origin+`/organizer/events/${eventId}/orders/${orderId}`)
    if(!financialSnapshot(orderId).operations.length) {
      value.results.refundOldUnusedQr??=await ticketQr(buyer.page,value.paidBuyerUrl!,0);saveScenario(value)
      await owner.page.getByRole('button',{name:'Refund order',exact:true}).click()
      await expect(owner.page.getByRole('dialog')).toContainText(displayMoney(baseline.finance.order.total_minor))
      await owner.page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click()
      expect(financialSnapshot(orderId)).toEqual(baseline.finance)
      expect(ticketFacts(orderId)).toEqual(before)
      expect((await control<{stripe:{refundIds:string[]}}>({action:'state'})).stripe.refundIds).toEqual(baseline.providerRefundIds)
      expect(await ownerMetrics(owner.page,eventId)).toEqual(baseline.metrics)
      await owner.page.goto(origin+`/organizer/events/${eventId}/orders/${orderId}`)
      await owner.page.getByRole('button',{name:'Refund order',exact:true}).click()
      await owner.page.getByRole('button',{name:'Confirm refund',exact:true}).click()
      await expect(owner.page.getByText(/^(Refund complete|Refund processing|Refund outcome unknown|Refund needs review|Refund failed)$/).first()).toBeVisible()
    }
    const claimed=financialSnapshot(orderId)
    expect(claimed.operations).toHaveLength(1)
    const operation=claimed.operations[0]
    expect(operation.idempotency_key).toBe('whereto-refund-integrity-v1:'+orderId)
    expect(operation.snapshot).toEqual(expectedRefundSnapshot(baseline.finance.order))
    const originalOperation=value.results.J05OriginalOperation??immutableOperation(operation)
    value.results.J05OriginalOperation=originalOperation;value.results.refundOperationKey=operation.idempotency_key;saveScenario(value)
    expect(immutableOperation(operation)).toEqual(originalOperation)
    const providerIds=(await control<{stripe:{refundIds:string[]}}>({action:'state'})).stripe.refundIds
    const newProviderIds=providerIds.filter(id=>!baseline.providerRefundIds.includes(id))
    expect(newProviderIds).toHaveLength(1)
    const retainedProviderId=value.results.J05OriginalProviderRefundId as string|undefined
    const providerRefundId=retainedRefundId(operation.stripe_refund_id,retainedProviderId,newProviderIds)
    expect(providerRefundId).toBe(newProviderIds[0])
    if(!providerRefundId)throw new Error('Original principal provider refund identity is missing; no replacement dispatch')
    value.results.J05OriginalProviderRefundId=providerRefundId;saveScenario(value)
    if(!operation.stripe_refund_id) {
      expect(operation.state).toBe('processing')
      expect(claimed.order).toEqual(baseline.finance.order)
      expect(claimed.items).toEqual(baseline.finance.items)
      expect(claimed.tickets).toEqual(baseline.finance.tickets)
      expect(claimed.refunds).toEqual(baseline.finance.refunds)
      value.results.J05BeforeExistingRefundObservation={finance:claimed,providerRefundId,capturedAt:new Date().toISOString()};saveScenario(value)
      await owner.page.reload()
      await expect(owner.page.getByRole('heading',{name:'Refund processing',exact:true}).first()).toBeVisible()
      expect(financialSnapshot(orderId)).toEqual(claimed)
      await checkExistingRefund(owner.page,eventId,orderId,'processing')
      const observed=financialSnapshot(orderId)
      expectRefundObservationPreservation(claimed,observed)
      expect(observed.operations[0].state).toBe('processing')
      expect(observed.operations[0].stripe_refund_id).toBe(providerRefundId)
      expect((await control<{stripe:{refundIds:string[]}}>({action:'state'})).stripe.refundIds).toEqual(providerIds)
      value.results.J05ExistingRefundObservation={finance:observed,providerRefundId,capturedAt:new Date().toISOString()};saveScenario(value)
    }
    expect(financialSnapshot(orderId).operations[0].stripe_refund_id).toBe(providerRefundId)
    await control({action:'stripe-event',type:'refund.updated',objectId:providerRefundId})
    await owner.page.reload()
    await expect(owner.page.getByText('Refund complete',{exact:true}).first()).toBeVisible()
    const completed=financialSnapshot(orderId),after=ticketFacts(orderId)
    expect(completed.items).toEqual(baseline.finance.items)
    expect(expectedRefundSnapshot(completed.order)).toEqual(expectedRefundSnapshot(baseline.finance.order))
    expect(immutableOriginalOrder(completed.order)).toEqual(immutableOriginalOrder(baseline.finance.order))
    expect(completed.order).toMatchObject({status:'refunded',reconciliation_status:'reconciled',failure_code:null})
    expect(completed.operations).toHaveLength(1);expect(immutableOperation(completed.operations[0])).toEqual(originalOperation)
    expect(completed.operations[0].completed_at).toBe(completed.order.refunded_at)
    expect(completed.refunds).toHaveLength(1)
    expect(completed.refunds[0]).toMatchObject({order_id:orderId,stripe_refund_id:providerRefundId,stripe_payment_intent_id:baseline.finance.order.stripe_payment_intent_id,stripe_charge_id:baseline.finance.order.stripe_charge_id,status:'succeeded',reason:'requested_by_customer',reverse_transfer:true,refund_application_fee:true,amount_minor:baseline.finance.order.total_minor,currency:baseline.finance.order.currency,transfer_reversal_amount_minor:baseline.finance.order.total_minor,application_fee_refund_amount_minor:baseline.finance.order.application_fee_amount_minor,policy_verified:true})
    expect(completed.refunds[0].stripe_transfer_reversal_id).toBeTruthy()
    expect(completed.refunds[0].stripe_application_fee_refund_id).toBeTruthy()
    expect(after.map(ticket=>ticket.id)).toEqual(before.map(ticket=>ticket.id));expect(after.map(ticket=>ticket.credentialHash)).toEqual(before.map(ticket=>ticket.credentialHash))
    expect(after.filter(ticket=>ticket.status==='used')).toHaveLength(1);expect(after.filter(ticket=>ticket.status==='refunded')).toHaveLength(2)
    const used=before.find(ticket=>ticket.status==='used')!
    expect(after.find(ticket=>ticket.id===used.id)).toEqual(used)
    expect(completed.tickets.find(ticket=>ticket.id===used.id)).toEqual(baseline.finance.tickets.find(ticket=>ticket.id===used.id))
    const completedMetrics=await ownerMetrics(owner.page,eventId)
    for(const field of ['grossSalesMinor','sold','orderCount','issued','checkedIn'] as const) expect(completedMetrics[field]).toBe(baseline.metrics[field])
    for(const tier of baseline.metrics.tiers) {
      const quantity=baseline.finance.items.filter(item=>item.ticket_tier_id===tier.id).reduce((total,item)=>total+item.quantity,0)
      expect(completedMetrics.tiers.find(row=>row.id===tier.id)?.remaining).toBe(tier.remaining+quantity)
    }
    await control({action:'stripe-event',type:'refund.updated',objectId:providerRefundId})
    const duplicateReceipt=financialSnapshot(orderId)
    expect(financialFactsWithoutReceiptAudit(duplicateReceipt)).toEqual(financialFactsWithoutReceiptAudit(completed));expect(ticketFacts(orderId)).toEqual(after)
    expect(completed.order.last_stripe_event_id).toBeTruthy()
    expect(duplicateReceipt.order.last_stripe_event_id).toBeTruthy()
    expect(duplicateReceipt.order.last_stripe_event_id).not.toBe(completed.order.last_stripe_event_id)
    value.results.J05DuplicateReceiptAudit={previous:completed.order.last_stripe_event_id,current:duplicateReceipt.order.last_stripe_event_id};saveScenario(value)
    expect(await ownerMetrics(owner.page,eventId)).toEqual(completedMetrics)
    await privateGoto(buyer.page,value.paidBuyerUrl!);await expectWalletFacts(buyer.page,after)
    if(typeof value.results.refundOldUnusedQr!=='string') throw new Error('Original unused QR was not retained before refund; do not issue a replacement')
    await qrCamera(owner.page,value.results.refundOldUnusedQr)
    await owner.page.goto(origin+`/organizer/events/${eventId}/check-in/scan`)
    await expect(owner.page.getByRole('heading',{name:'Ticket refunded',exact:true})).toBeVisible()
    await exactRefundNotice(value,'J05NoticeWorker',orderId,'accepted')
    const notices=outboxRows(`purpose='refund_notice' and order_id=${quote(orderId)}`)
    expect(notices).toHaveLength(1)
    const refundUrl=messageLink(await acceptedMessage(notices[0]))
    value.results.J05RefundNoticeUrl=refundUrl;saveScenario(value)
    const fresh=await realContext(browser,'principal-refund-notice')
    try {
      const response=fresh.page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/functions/v1/refund-detail-access'))
      await privateGoto(fresh.page,refundUrl)
      const body=await (await response).json() as {order:{tickets:{id:string;status:string;usedAt:string|null}[]}}
      await expect(fresh.page.getByRole('heading',{name:'Your order has been refunded',exact:true})).toBeVisible()
      await expect(fresh.page.getByText('Order #'+baseline.finance.order.order_number,{exact:true}).first()).toBeVisible()
      await expect(fresh.page.getByText(value.events!.paid.title,{exact:true}).first()).toBeVisible()
      for(const label of ['Total paid','Refund amount']) await expect(fresh.page.getByRole('region',{name:'Refund details',exact:true}).locator('dl div').filter({has:fresh.page.getByText(label,{exact:true})}).locator('dd')).toHaveText(displayMoney(baseline.finance.order.total_minor))
      for(const item of baseline.finance.items) {
        const row=fresh.page.locator('.refund-details__item').filter({hasText:`${item.quantity} × ${item.tier_name}`})
        await expect(row).toContainText(displayMoney(item.subtotal_minor))
      }
      expect(body.order.tickets.map(ticket=>({id:ticket.id,status:ticket.status,usedAt:ticket.usedAt})).sort((a,b)=>a.id.localeCompare(b.id))).toEqual(after.map(ticket=>({id:ticket.id,status:ticket.status,usedAt:ticket.usedAt})).sort((a,b)=>a.id.localeCompare(b.id)))
      await expect(fresh.page.locator('.refund-inactive-ticket--used')).toHaveCount(1);await expect(fresh.page.locator('.refund-inactive-ticket--refunded')).toHaveCount(2)
      await expect(fresh.page.locator('.refund-inactive-ticket--used')).toContainText(formatOperationDateTime(used.usedAt))
      await expect(fresh.page.getByLabel('Admission QR code',{exact:true})).toHaveCount(0)
      await expect(fresh.page.getByRole('link',{name:/View first ticket|Show QR|Use ticket/})).toHaveCount(0)
    } finally {await fresh.close()}
    expect(financialSnapshot(orderId)).toEqual(duplicateReceipt);expect(ticketFacts(orderId)).toEqual(after)
    value.results.J05={outcome:'passed-connected-core',orderId,operationKey:operation.idempotency_key,refundId:operation.stripe_refund_id,usedAt:used.usedAt,initialSnapshotRetained:true,releaseOnce:true,refundNoticeOutboxId:notices[0].id,refundNoticeProviderId:notices[0].provider_id,remaining:['supplemental refund modes tracked separately']}
  } finally {await owner.close();await buyer.close()}
}))

test('J06 separate terminal datasets: saved changes and paid/free cancellation', async ({ browser }) => journey('J06', async value => {
  const owner = await realContext(browser, 'organizer')
  try {
    await organizerLogin(owner.page, value)
    // These event identities are explicitly separate because J05's paid source is refunded.
    // They never replace an unknown checkout or erase a principal event's history.
    const paidId = value.results.J06Cancelledpaid ? requireId(value.events?.changesPaid.id, 'Recorded cancelled paid event') : await eventThroughUi(owner.page, value, 'changesPaid', 'paid')
    const freeId = value.results.J06Cancelledfree ? requireId(value.events?.cancellationFree.id, 'Recorded cancelled free event') : await eventThroughUi(owner.page, value, 'cancellationFree', 'free')
    const sourceOne = await realContext(browser, 'changes-paid-one')
    const sourceTwo = await realContext(browser, 'changes-paid-two')
    const freeBuyer = await realContext(browser, 'cancellation-free-buyer')
    try {
      const first = await separatePaidSource(sourceOne.page, value, paidId, 'changesOrderOne')
      await separatePaidSource(sourceTwo.page, value, paidId, 'changesOrderTwo')
      const facts = ticketFacts(first.orderId)
      if (!value.results.cancellationPaidOldQr && !value.results.J06Cancelledpaid) { value.results.cancellationPaidOldQr = await ticketQr(sourceOne.page, first.collectionUrl, 0); saveScenario(value) }
      if (!value.results.J06Cancelledpaid) await manual(owner.page, paidId, first.orderId, facts[1].id, false)
      if (!value.results.cancellationFreeSource) {
        await discover(freeBuyer.page, freeId)
        await freeBuyer.page.getByRole('link', { name: /RSVP/ }).click()
        await freeBuyer.page.getByRole('button', { name: 'Increase quantity', exact: true }).click({ clickCount: 2 })
        await freeBuyer.page.getByRole('button', { name: 'Continue', exact: true }).click()
        await freeBuyer.page.getByLabel('Full name', { exact: true }).fill('Free Guest')
        await freeBuyer.page.getByLabel('Email address', { exact: true }).fill(emailFor(value, 'cancellation-free'))
        await freeBuyer.page.getByRole('button', { name: 'Confirm RSVP', exact: true }).click()
        const collectionUrl = await collection(freeBuyer.page)
        const rows = dbJson<{ id: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id)), '[]'::jsonb) from public.free_registrations where event_id=${quote(freeId)} and email=${quote(emailFor(value, 'cancellation-free'))};`)
        expect(rows.length).toBe(1)
        value.results.cancellationFreeSource = { registrationId: rows[0].id, collectionUrl }; saveScenario(value)
      }
      const source = value.results.cancellationFreeSource as { registrationId: string; collectionUrl: string }
      if (!value.results.cancellationFreeOldQr && !value.results.J06Cancelledfree) { value.results.cancellationFreeOldQr = await ticketQr(freeBuyer.page, source.collectionUrl, 0); saveScenario(value) }
      if (!value.results.J06Cancelledfree) await manual(owner.page, freeId, source.registrationId, ticketFacts(source.registrationId, true)[1].id, true)
    } finally { await sourceOne.close(); await sourceTwo.close(); await freeBuyer.close() }
    const changed = value.results.J06ChangedVenue === true
    if (!changed) {
      if (!value.results.J06RevisionPublished) {
      await owner.page.goto(origin + `/organizer/events/${paidId}/edit`)
      await owner.page.getByRole('button', { name: 'Continue to date & location', exact: true }).click()
      await owner.page.getByLabel('Venue name', { exact: true }).fill('Spec14 Updated Community Terrace')
      let savedRepliesDropped = 0
      await owner.page.route('**/rest/v1/rpc/save_owned_event_revision_if_current', async route => {
        const response = await route.fetch()
        if (!response.ok()) throw new Error('Event revision failed before committed reply-loss control')
        savedRepliesDropped++; await route.abort('failed')
      }, { times: 1 })
      await owner.page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(owner.page.getByRole('heading', { name: 'Save result unknown', exact: true })).toBeVisible()
      await expect(owner.page.getByLabel('Venue name', { exact: true })).toHaveValue('Spec14 Updated Community Terrace')
      expect(savedRepliesDropped).toBe(1)
      await owner.page.getByRole('button', { name: 'Reload saved version', exact: true }).click()
      await owner.page.getByRole('button', { name: 'Keep reviewing my inputs', exact: true }).click()
      await expect(owner.page.getByRole('heading', { name: 'Save result unknown', exact: true })).toBeVisible()
      await owner.page.getByRole('button', { name: 'Reload saved version', exact: true }).click()
      await owner.page.getByRole('button', { name: 'Discard inputs and reload', exact: true }).click()
      await expect(owner.page.getByRole('heading', { name: 'Save result unknown', exact: true })).toHaveCount(0)
      await expect(owner.page.getByLabel('Venue name', { exact: true })).toHaveValue('Spec14 Updated Community Terrace')
      value.results.J06LostSaveReply = { eventId: paidId, originalVenueAdoptedAfterExplicitReload: true, writeRequests: savedRepliesDropped }; saveScenario(value)
      await owner.page.reload()
      await owner.page.getByRole('button', { name: 'Continue to date & location', exact: true }).click()
      await expect(owner.page.getByLabel('Venue name', { exact: true })).toHaveValue('Spec14 Updated Community Terrace')
      await owner.page.getByRole('button', { name: 'Continue to tickets & admission', exact: true }).click()
      await owner.page.getByRole('button', { name: 'Continue to event requirements', exact: true }).click()
      await owner.page.getByRole('button', { name: 'Continue to organizer agreement', exact: true }).click()
      await owner.page.getByRole('checkbox', { name: /I confirm that this event information/ }).check()
      await owner.page.getByRole('button', { name: 'Save agreement and preview', exact: true }).click()
      await confirmRepublishedRevision(owner.page, value, paidId)
      value.results.J06RevisionPublished = true; saveScenario(value)
      }
      await owner.page.goto(origin + `/organizer/events/${paidId}/changes`)
      if (!value.results.J06OriginalNoticeIntent) {
      await owner.page.getByRole('button', { name: 'Review notice recipients', exact: true }).click()
      await expect(owner.page.getByRole('heading', { name: 'Reviewed audience', exact: true })).toBeVisible()
      await expect(owner.page.locator('.event-notice-review dl div').filter({ has: owner.page.getByText('Eligible messages', { exact: true }) }).locator('dd')).toHaveText('2')
      await expect(owner.page.locator('.event-notice-review dl div').filter({ has: owner.page.getByText('Distinct recipient addresses', { exact: true }) }).locator('dd')).toHaveText('1')
      await owner.page.route('**/rest/v1/rpc/submit_owned_event_notice', async route => {
        const response = await route.fetch()
        if (!response.ok()) throw new Error('Notice submission failed before committed reply-loss control')
        await route.abort('failed')
      }, { times: 1 })
      await owner.page.getByRole('button', { name: 'Submit reviewed notice', exact: true }).click()
      await expect(owner.page.getByText(/Submission result unknown/)).toBeVisible()
      const intent = await owner.page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith('wheretoo:event-notice:v1:'))))
      value.results.J06OriginalNoticeIntent = intent; saveScenario(value)
      }
      const notice = dbJson<{ id: string; requestId: string; sources: number }>(`select jsonb_build_object('id',n.id,'requestId',n.request_id,'sources',(select count(*) from private.event_notice_sources s where s.notice_id=n.id)) from private.event_notices n where n.event_id=${quote(paidId)} and n.purpose='event_change';`)
      expect(notice.sources).toBe(2)
      await owner.page.reload()
      await owner.page.getByRole('button', { name: 'Retry same notice submission', exact: true }).click()
      await expect(owner.page.getByText('2 messages queued. This does not confirm sending or delivery.', { exact: true })).toBeVisible()
      expect(dbJson<{ count: number }>(`select jsonb_build_object('count',count(*)) from private.event_notices where event_id=${quote(paidId)} and purpose='event_change';`).count).toBe(1)
      value.results.J06Notice = { ...notice, distinctRecipients: 1, committedReplyLostReconciled: true }
      value.results.J06ChangedVenue = true; saveScenario(value)
    }
    // Cancellation adds later history; retain this completed pre-cancellation comparison on resume.
    if (!value.results.J06HistoryCompared) {
      await owner.page.goto(origin + `/organizer/events/${paidId}/changes`)
      const savedHistory = owner.page.locator('.event-change-section').filter({ has: owner.page.getByRole('heading', { name: 'Saved changes', exact: true }) })
      const publicHistory = owner.page.locator('.event-change-section').filter({ has: owner.page.getByRole('heading', { name: 'Actual public history', exact: true }) })
      const savedVenue = savedHistory.locator('table').first().getByRole('row').filter({ has: owner.page.getByRole('rowheader', { name: 'Venue', exact: true }) })
      const publicVenue = publicHistory.locator('table').first().getByRole('row').filter({ has: owner.page.getByRole('rowheader', { name: 'Venue', exact: true }) })
      await expect(savedVenue.locator('td').nth(1)).toHaveText('Spec14 Updated Community Terrace')
      await expect(publicVenue.locator('td').nth(0)).toHaveText('Spec14 Community Hall')
      await expect(publicVenue.locator('td').nth(1)).toHaveText('Spec14 Updated Community Terrace')
      value.results.J06HistoryCompared = { saved: 'Spec14 Updated Community Terrace', previousPublic: 'Spec14 Community Hall', currentPublic: 'Spec14 Updated Community Terrace' }; saveScenario(value)
    }
    const salesCount = () => dbJson<{ paid: number; free: number }>(`select jsonb_build_object('paid',(select count(*) from public.orders where event_id=${quote(paidId)}),'free',(select count(*) from public.free_registrations where event_id=${quote(freeId)}));`)
    const salesBeforeCancellation = salesCount()
    let refundRequests = 0
    owner.page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/functions/v1/organizer-refund-order')) refundRequests++ })
    for (const [kind, id] of [['paid', paidId], ['free', freeId]] as const) {
      await owner.page.goto(origin + `/organizer/events/${id}/cancellation`)
      const status = dbJson<{ status: string }>(`select jsonb_build_object('status',status) from public.events where id=${quote(id)};`).status
      if (status !== 'cancelled') {
        let cancelledRequestCount = 0
        let replyLostAfterCommit = false
        owner.page.on('request', request => {
          if (new URL(request.url()).pathname.endsWith('/rpc/cancel_owned_event') && request.postDataJSON()?.p_event_id === id) cancelledRequestCount++
        })
        await owner.page.route('**/rest/v1/rpc/cancel_owned_event', async route => {
          if (route.request().postDataJSON().p_event_id !== id) return route.fallback()
          const response = await route.fetch()
          if (!response.ok()) throw new Error('Canonical cancellation failed before the transport-loss control')
          replyLostAfterCommit = true
          await route.abort('failed')
        }, { times: 1 })
        await owner.page.getByRole('button', { name: 'Cancel event', exact: true }).click()
        await owner.page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click()
        await expect(owner.page.getByRole('heading', { name: 'Event cancelled', exact: true })).toBeVisible()
        expect(replyLostAfterCommit).toBe(true); expect(cancelledRequestCount).toBe(1)
        value.results['J06LostCancellationReply' + kind] = { eventId: id, writeRequests: cancelledRequestCount }
        saveScenario(value)
      }
      await expect(owner.page.getByRole('heading', { name: 'Event cancelled', exact: true })).toBeVisible()
      const source = kind === 'paid' ? value.results.changesOrderOne as { orderId: string } : value.results.cancellationFreeSource as { registrationId: string }
      const facts = ticketFacts('orderId' in source ? source.orderId : source.registrationId, kind === 'free')
      expect(facts.filter(ticket => ticket.status === 'used')).toHaveLength(1)
      expect(facts.filter(ticket => ticket.status === 'cancelled')).toHaveLength(2)
      value.results['J06Cancelled' + kind] = id; saveScenario(value)
      const oldQr = value.results[kind === 'paid' ? 'cancellationPaidOldQr' : 'cancellationFreeOldQr']
      if (typeof oldQr !== 'string') throw new Error('Original cancellation QR evidence missing; no replacement credential permitted')
      const scanner = await owner.context.newPage()
      const privateBuyer = await realContext(browser, 'cancelled-proof-' + kind)
      try {
        let admissionRequests = 0
        scanner.on('request', request => {
          if (new URL(request.url()).pathname === '/functions/v1/ticket-admission' && request.method() !== 'OPTIONS') admissionRequests++
        })
        await qrCamera(scanner, oldQr)
        await scanner.goto(origin + `/organizer/events/${id}/check-in/scan`)
        // A fresh cancelled-event scanner closes before mounting the QR decoder.
        await expect(scanner.getByRole('heading', { name: 'Check-in closed', exact: true })).toBeVisible()
        await expect(scanner.getByText('Event history remains available.', { exact: true })).toBeVisible()
        await expect(scanner.getByLabel('Camera preview', { exact: true })).toHaveCount(0)
        expect(admissionRequests).toBe(0)
        const savedSource = value.results[kind === 'paid' ? 'changesOrderOne' : 'cancellationFreeSource'] as { collectionUrl: string }
        await privateGoto(privateBuyer.page, savedSource.collectionUrl)
        await expect(privateBuyer.page.getByText(/Cancelled/).first()).toBeVisible()
        expect(ticketFacts('orderId' in source ? source.orderId : source.registrationId, kind === 'free')).toEqual(facts)
        expect(admissionRequests).toBe(0)
      } finally { await scanner.close(); await privateBuyer.close() }
    }
    expect(refundRequests).toBe(0)
    expect(dbJson<{ count: number }>(`select jsonb_build_object('count',count(*)) from private.order_refund_operations r join public.orders o on o.id=r.order_id where o.event_id=${quote(paidId)};`).count).toBe(0)
    // A new anonymous context reads every filtered page and both public sales entries.
    const postCancellation = await realContext(browser, 'j06-post-cancel-public')
    let checkoutCreates = 0
    let freeRsvpWrites = 0
    postCancellation.page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.endsWith('/functions/v1/stripe-create-checkout')) checkoutCreates++
      if (path.endsWith('/functions/v1/free-rsvp')) freeRsvpWrites++
    })
    try {
      for (const [kind, id] of [['paid', paidId], ['free', freeId]] as const) {
        await postCancellation.page.goto(origin + `/discover?category=community&price=${kind}`)
        await expect(postCancellation.page.getByLabel('Discovery results', { exact: true })).toBeVisible()
        for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
          await expect(postCancellation.page.locator(`a[href="/events/${id}"]`)).toHaveCount(0)
          const more = postCancellation.page.getByRole('button', { name: 'Load more', exact: true })
          if (!await more.isVisible()) break
          await Promise.all([
            postCancellation.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/functions/v1/public-discovery') && response.request().method() === 'POST'),
            more.click(),
          ])
          await expect(postCancellation.page.getByRole('button', { name: 'Loading more events…', exact: true })).toHaveCount(0)
          if (pageNumber === 9) throw new Error('Filtered discovery pagination exceeded the bounded J06 proof')
        }
        await postCancellation.page.goto(origin + `/events/${id}${kind === 'paid' ? '/tickets' : ''}`)
        await expect(postCancellation.page.getByRole('heading', { name: 'Event not found', exact: true })).toBeVisible()
      }
      expect(checkoutCreates).toBe(0); expect(freeRsvpWrites).toBe(0)
      expect(salesCount()).toEqual(salesBeforeCancellation)
    } finally { await postCancellation.close() }
    value.results.J06 = { outcome: 'passed-connected-core', paidId, freeId, historyCompared: value.results.J06HistoryCompared, postCancellationUnavailable: true, refundRequests, supplementalProof: ['J06a late payment', 'J06b stale save', 'J06c postponement', 'J06d stale notice'], remaining: ['supplemental runtime results tracked separately'] }
  } finally { await owner.close() }
}))

test('J07 Settings routes, profile persistence, same-event Payments and guest access after sign-out', async ({ browser }) => journey('J07', async value => {
  const owner = await realContext(browser, 'organizer')
  const buyer = await realContext(browser, 'free-buyer')
  try {
    await organizerLogin(owner.page, value)
    for (const path of ['account', 'profile', 'help', 'actions']) {
      await owner.page.goto(origin + '/organizer/settings/' + path)
      await expect(owner.page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    }
    if (!value.results.J07AccountUpdated) {
      await owner.page.goto(origin + '/organizer/settings/account')
      await owner.page.getByRole('button', { name: 'Edit account name', exact: true }).click()
      await owner.page.getByRole('textbox', { name: 'Account name', exact: true }).fill('Spec14 Private Account ' + value.runId)
      await owner.page.getByRole('button', { name: 'Save account name', exact: true }).click()
      await expect(owner.page.getByText('Account name updated.', { exact: true })).toBeVisible()
      const oldEmail = value.organizerEmail
      const nextEmail = 'organizer-updated-' + value.runId + '@spec14.test'
      value.results.pendingOrganizerEmail = nextEmail; saveScenario(value)
      if (oldEmail !== nextEmail) {
        await owner.page.getByRole('button', { name: 'Change login email', exact: true }).click()
        await owner.page.getByLabel('New login email', { exact: true }).fill(nextEmail)
        await owner.page.getByRole('button', { name: 'Request email change', exact: true }).click()
        await expect(owner.page.getByText('Email confirmation pending', { exact: true })).toBeVisible()
        const confirmation = await realContext(browser, 'account-confirmation')
        try { await confirmLocalEmailChange(confirmation.page, oldEmail, nextEmail) } finally { await confirmation.close() }
        await expect.poll(() => dbJson<{ email: string }>(`select jsonb_build_object('email',email) from auth.users where id=${quote(requireId(value.organizerId, 'Organizer'))};`).email).toBe(nextEmail)
        value.organizerEmail = nextEmail; saveScenario(value)
      }
      await owner.page.getByRole('button', { name: 'Refresh account status', exact: true }).click()
      await expect(owner.page.getByText(nextEmail, { exact: true })).toBeVisible()
      const nextPassword = typeof value.results.pendingOrganizerPassword === 'string' ? value.results.pendingOrganizerPassword : 'Local-updated-' + value.runId + '-long-password'
      value.results.pendingOrganizerPassword = nextPassword; saveScenario(value)
      if (!value.results.J07PasswordConfirmedByLogin) {
      await owner.page.getByRole('button', { name: 'Change password', exact: true }).click()
      await owner.page.getByLabel('New password', { exact: true }).fill(nextPassword)
      await owner.page.getByLabel('Confirm new password', { exact: true }).fill(nextPassword + '-mismatch')
      await owner.page.getByRole('button', { name: 'Save password', exact: true }).click()
      await expect(owner.page.getByText('The new passwords do not match.', { exact: true })).toBeVisible()
      await owner.page.getByLabel('Confirm new password', { exact: true }).fill(nextPassword)
      await owner.page.getByRole('button', { name: 'Save password', exact: true }).click()
      await expect.poll(async () => await owner.page.getByText('Password updated.', { exact: true }).isVisible() || await owner.page.getByRole('button', { name: 'Send verification code', exact: true }).isVisible(), { message: 'Real Auth password update or explicit reauthentication requirement' }).toBe(true)
      if (await owner.page.getByRole('button', { name: 'Send verification code', exact: true }).isVisible()) {
        await owner.page.getByRole('button', { name: 'Send verification code', exact: true }).click()
        const code = async () => (await localAuthMessages(nextEmail)).filter(message => /reauth|verification/i.test(message.subject)).flatMap(message => message.body.match(/\b\d{6}\b/g) ?? [])[0]
        await expect.poll(code, { message: 'Local Auth reauthentication code arrived' }).toBeTruthy()
        await owner.page.getByLabel('Verification code', { exact: true }).fill((await code())!)
        await owner.page.getByRole('button', { name: 'Save password', exact: true }).click()
      }
      await expect(owner.page.getByText('Password updated.', { exact: true })).toBeVisible()
      }
      value.organizerPassword = nextPassword; value.results.J07AccountUpdated = true; saveScenario(value)
      const fresh = await realContext(browser, 'updated-account-login')
      try { await organizerLogin(fresh.page, value); await expect(fresh.page.getByRole('heading', { name: 'My Events', exact: true })).toBeVisible() } finally { await fresh.close() }
    }
    await owner.page.goto(origin + '/organizer/settings/profile')
    const bio = 'Local Spec14 saved profile ' + value.runId
    await owner.page.getByLabel(/^Bio/).fill(bio)
    if (await owner.page.getByRole('button', { name: 'Save profile', exact: true }).isEnabled()) await owner.page.getByRole('button', { name: 'Save profile', exact: true }).click()
    await expect(owner.page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled()
    await owner.page.reload(); await expect(owner.page.getByLabel(/^Bio/)).toHaveValue(bio)
    await owner.page.goto(origin + '/organizer/settings/payments?eventId=' + requireId(value.paidEventId, 'Paid event'))
    await expect(owner.page.getByRole('heading', { name: 'You’re all set!', exact: true })).toBeVisible()
    await owner.page.goto(origin + '/organizer/settings/actions')
    await owner.page.getByRole('button', { name: 'Sign out', exact: true }).last().click()
    const confirm = owner.page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true })
    if (await confirm.isVisible()) await confirm.click()
    await expect.poll(() => new URL(owner.page.url()).pathname).toBe('/auth/sign-in')
    await privateGoto(buyer.page, value.freeBuyerUrl!)
    await expect(buyer.page.locator('.buyer-wallet-row')).toHaveCount(3)
    value.results.J07 = { outcome: 'passed-connected-core', authRace: 'B1 remains blocked; this is only the single-organizer ordinary flow', remaining: ['profile conflict controls', 'same-event embedded failure return', 'account update dropped-response reconciliation'] }
  } finally { await owner.close(); await buyer.close() }
}))

test('J08 negative deep links, offline retained identity and organizer guard without fabricated responses', async ({ browser }) => journey('J08', async value => {
  const visitor = await realContext(browser, 'negative-anonymous')
  let initializationCalls = 0
  visitor.context.on('request', request => { if (new URL(request.url()).pathname.endsWith('/stripe-create-checkout')) initializationCalls++ })
  try {
    for (const path of ['/events/checkout', '/events//checkout', '/events/not-a-uuid/checkout']) {
      await visitor.page.goto(origin + path)
      await expect(visitor.page.locator('body')).not.toBeEmpty()
    }
    expect(initializationCalls).toBe(0)
    const eventId = requireId(value.freeEventId, 'Free event')
    await visitor.page.goto(origin + `/organizer/events/${eventId}/check-in/find`)
    await expect.poll(() => new URL(visitor.page.url()).pathname).toBe('/auth/sign-in')
    await privateGoto(visitor.page, value.freeBuyerUrl!)
    await expect(visitor.page.locator('.buyer-wallet-row')).toHaveCount(3)
    const before = ticketFacts(requireId(value.freeRegistrationId, 'Free registration'), true)
    await visitor.context.setOffline(true)
    let offlineReadFailed = false
    try { await visitor.page.reload() } catch { offlineReadFailed = true }
    expect(offlineReadFailed).toBe(true)
    await visitor.context.setOffline(false)
    await privateGoto(visitor.page, value.freeBuyerUrl!)
    await expect(visitor.page.locator('.buyer-wallet-row')).toHaveCount(3)
    expect(ticketFacts(value.freeRegistrationId!, true)).toEqual(before)
    value.results.J08 = { outcome: 'passed-partial-negative-path', remaining: ['commit-boundary lost replies/offline controls for checkout/RSVP/admission/refund/notice/cancellation', 'retained checkout corruption and complete-proof-loss controls', 'private purpose/membership/expiry/revocation matrix', 'A→B→A SDK blocker remains unresolved'] }
    expect(visitor.blocked).toEqual([])
  } finally { await visitor.close() }
}))

test('J08a checkout committed reply loss, corruption guards and same-attempt hosted recovery', async ({ browser }) => journey('J08a', async value => {
  const eventId = requireId(value.paidEventId, 'Principal paid event')
  const buyer = await realContext(browser, 'checkout-unknown-control')
  const email = emailFor(value, 'checkout-unknown')
  let createCalls = 0
  buyer.context.on('request', request => { if (new URL(request.url()).pathname.endsWith('/stripe-create-checkout')) createCalls++ })
  try {
    if (value.results.J08a) {
      const order = dbJson<{ count: number; tickets: number }>(`select jsonb_build_object('count',count(*),'tickets',(select count(*) from public.tickets where order_id in (select id from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(email)}))) from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(email)};`)
      expect(order).toEqual({ count: 1, tickets: 3 }); return
    }
    if (typeof value.results.unknownCheckoutUrl === 'string') await privateGoto(buyer.page, value.results.unknownCheckoutUrl)
    else {
      await discover(buyer.page, eventId)
      await buyer.page.getByLabel('General Admission quantity', { exact: true }).fill('2')
      await buyer.page.getByLabel('VIP quantity', { exact: true }).fill('1')
      await continueToCheckout(buyer.page)
      value.results.unknownCheckoutUrl = buyer.page.url(); saveScenario(value)
      let dropped = false
      await buyer.page.route('**/functions/v1/stripe-create-checkout', async route => {
        const response = await route.fetch()
        if (!response.ok()) throw new Error('Checkout failed before committed-reply-loss control')
        dropped = true; await route.abort('failed')
      }, { times: 1 })
      await buyer.page.getByLabel('Your name', { exact: true }).fill('Unknown Checkout Guest')
      await buyer.page.getByLabel('Email address', { exact: true }).fill(email)
      await buyer.page.getByRole('button', { name: 'Continue to secure payment', exact: true }).click()
      await expect(buyer.page.getByRole('heading', { name: 'Unable to confirm payment', exact: true })).toBeVisible()
      expect(dropped).toBe(true)
    }
    const saved = await buyer.page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith('whereto.checkout-attempt.v1:'))))
    const retained = Object.keys(saved).find(key => !key.endsWith(':seen'))
    if (!retained) throw new Error('Original checkout state is missing; do not authorize a replacement purchase')
    value.results.unknownCheckoutOriginalSession = saved; saveScenario(value)
    const canonical = dbJson<{ id: string; session: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'session',stripe_checkout_session_id)), '[]'::jsonb) from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(email)};`)
    expect(canonical).toHaveLength(1)
    const baselineCalls = createCalls
    for (const corruption of ['malformed', 'missing-with-seen'] as const) {
      await buyer.page.evaluate(({ key, corruption }) => { if (corruption === 'malformed') sessionStorage.setItem(key, '{'); else sessionStorage.removeItem(key) }, { key: retained, corruption })
      await buyer.page.reload()
      await expect(buyer.page.getByRole('heading', { name: 'Unable to confirm payment', exact: true })).toBeVisible()
      expect(await buyer.page.getByRole('button', { name: 'Continue to secure payment', exact: true }).count()).toBe(0)
      expect(await buyer.page.getByRole('button', { name: 'Check status', exact: true }).count()).toBe(0)
      expect(createCalls).toBe(baselineCalls)
      await buyer.page.evaluate(original => { for (const [key, item] of Object.entries(original)) sessionStorage.setItem(key, item) }, saved)
      await buyer.page.reload()
    }
    const check = buyer.page.getByRole('button', { name: 'Check status', exact: true })
    await expect.poll(async () => await check.isVisible() || await buyer.page.getByRole('button', { name: /^(Re-enter original details|Retry same checkout)$/ }).isVisible()).toBe(true)
    if (await check.isVisible()) await check.click()
    const retry = buyer.page.getByRole('button', { name: /^(Re-enter original details|Retry same checkout)$/ })
    await expect(retry).toBeEnabled(); await retry.click()
    if (await buyer.page.getByLabel('Your name', { exact: true }).isVisible()) {
      await buyer.page.getByLabel('Your name', { exact: true }).fill('Unknown Checkout Guest')
      await buyer.page.getByLabel('Email address', { exact: true }).fill(email)
      await buyer.page.getByRole('button', { name: 'Retry same checkout', exact: true }).click()
    }
    await expect(buyer.page.getByRole('button', { name: 'Complete simulated payment', exact: true })).toBeVisible()
    const hostedSession = new URL(buyer.page.url()).pathname.split('/').at(-1)
    expect(hostedSession).toBe(canonical[0].session)
    await buyer.page.getByRole('button', { name: 'Complete simulated payment', exact: true }).click()
    await expect(buyer.page.getByRole('heading', { name: "You're all set", exact: true })).toBeVisible()
    value.results.unknownCheckoutCollectionUrl = await collection(buyer.page)
    expect(ticketFacts(canonical[0].id)).toHaveLength(3)
    const final = dbJson<{ id: string; session: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'session',stripe_checkout_session_id)), '[]'::jsonb) from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(email)};`)
    expect(final).toEqual(canonical)
    value.results.J08a = { orderId: canonical[0].id, sameHostedSession: true, corruptionBlockedReplacement: true, committedReplyLost: true }
  } finally { await buyer.close() }
}))

test('J08b RSVP lost committed reply rechecks the original request and preserves all three tickets', async ({ browser }) => journey('J08b', async value => {
  const eventId = requireId(value.freeEventId, 'Principal free event')
  const buyer = await realContext(browser, 'rsvp-unknown-control')
  const email = emailFor(value, 'rsvp-unknown')
  let creates = 0
  buyer.context.on('request', request => { if (new URL(request.url()).pathname.endsWith('/functions/v1/free-rsvp')) creates++ })
  try {
    const retainedProof = value.results.unknownRsvpProof
    if (!value.results.J08b && typeof retainedProof === 'string') {
      const identity = JSON.parse(retainedProof) as { requestId: string; collectionBearer: string }
      const rows = dbJson<{ id: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id)), '[]'::jsonb) from public.free_registrations where event_id=${quote(eventId)} and email=${quote(email)};`)
      expect(rows).toHaveLength(1)
      const before = ticketFacts(rows[0].id, true)
      await buyer.page.route('**/functions/v1/free-rsvp', route => route.abort('blockedbyclient'))
      await discover(buyer.page, eventId)
      await buyer.page.getByRole('link', { name: /RSVP/ }).click()
      const current = JSON.parse((await buyer.page.evaluate(id => localStorage.getItem('wheretoo.rsvp.v1:' + id), eventId))!) as { requestId: string; collectionBearer: string }
      expect(current.requestId).toBe(identity.requestId); expect(current.collectionBearer === identity.collectionBearer).toBe(true)
      const originalCollection = await collection(buyer.page)
      await expectWalletFacts(buyer.page, before)
      await buyer.page.reload(); await expectWalletFacts(buyer.page, before)
      expect(ticketFacts(rows[0].id, true)).toEqual(before)
      expect(dbJson<{ count: number }>(`select jsonb_build_object('count',count(*)) from public.free_registrations where event_id=${quote(eventId)} and email=${quote(email)};`).count).toBe(1)
      expect(creates).toBe(0)
      value.results.unknownRsvpCollectionUrl = originalCollection
      value.results.J08b = { registrationId: rows[0].id, ticketIds: before.map(ticket => ticket.id), originalRequestRechecked: true, initialReloadResolvedAutomatically: true, readOnlyResumeCreates: creates, originalProofPreserved: true }
      return
    }
    if (!value.results.J08b) {
      await discover(buyer.page, eventId)
      await buyer.page.getByRole('link', { name: /RSVP/ }).click()
      const prior = await buyer.page.evaluate(id => localStorage.getItem('wheretoo.rsvp.v1:' + id), eventId)
      if (!prior) {
        await buyer.page.getByRole('button', { name: 'Increase quantity', exact: true }).click({ clickCount: 2 })
        await buyer.page.getByRole('button', { name: 'Continue', exact: true }).click()
        await buyer.page.getByLabel('Full name', { exact: true }).fill('Unknown Free Guest')
        await buyer.page.getByLabel('Email address', { exact: true }).fill(email)
        await buyer.page.route('**/functions/v1/free-rsvp', async route => { const response = await route.fetch(); if (!response.ok()) throw new Error('RSVP failed before transport-loss control'); await route.abort('failed') }, { times: 1 })
        await buyer.page.getByRole('button', { name: 'Confirm RSVP', exact: true }).click()
      }
      await expect(buyer.page.getByRole('button', { name: 'Check RSVP status', exact: true })).toBeVisible()
      const original = await buyer.page.evaluate(id => localStorage.getItem('wheretoo.rsvp.v1:' + id), eventId)
      if (!original) throw new Error('Lost the original RSVP request proof')
      const identity = JSON.parse(original) as { requestId: string; collectionBearer: string }
      value.results.unknownRsvpProof = original; saveScenario(value)
      const rows = dbJson<{ id: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id)), '[]'::jsonb) from public.free_registrations where event_id=${quote(eventId)} and email=${quote(email)};`)
      expect(rows).toHaveLength(1)
      const before = ticketFacts(rows[0].id, true)
      value.results.unknownRsvpInitialTickets = before; saveScenario(value)
      await buyer.page.reload()
      const tickets = buyer.page.getByRole('link', { name: /^View( your)? tickets$/ })
      const check = buyer.page.getByRole('button', { name: 'Check RSVP status', exact: true })
      await expect.poll(async () => await tickets.isVisible() || (await check.isVisible() && await check.isEnabled())).toBe(true)
      if (!await tickets.isVisible()) await check.click()
      await expect(buyer.page.getByRole('link', { name: /^View( your)? tickets$/ })).toBeVisible()
      const after = JSON.parse((await buyer.page.evaluate(id => localStorage.getItem('wheretoo.rsvp.v1:' + id), eventId))!) as { requestId: string; collectionBearer: string }
      expect(after.requestId).toBe(identity.requestId); expect(after.collectionBearer === identity.collectionBearer).toBe(true)
      expect(ticketFacts(rows[0].id, true)).toEqual(before)
      expect(creates).toBe(1)
      value.results.J08b = { registrationId: rows[0].id, ticketIds: before.map(ticket => ticket.id), originalRequestRechecked: true }
    }
  } finally { await buyer.close() }
}))

test('J04a resend uses recorded recipients and preserves failed or unknown request identities', async ({ browser }) => journey('J04a', async value => {
  const eventId = requireId(value.freeEventId, 'Free event')
  const reverse = value.results.freeReverse as { registrationId?: string } | undefined
  const cases = [
    { mode: 'failed', id: requireId(value.freeRegistrationId, 'Free registration'), recipient: emailFor(value, 'free'), title: 'Couldn’t resend tickets' },
    { mode: 'unknown', id: requireId(reverse?.registrationId, 'QR-first free registration'), recipient: emailFor(value, 'free-reverse'), title: 'Send status unknown' },
  ] as const
  const owner = await realContext(browser, 'organizer')
  try {
    await organizerLogin(owner.page, value)
    for (const item of cases) {
      const beforeTickets = ticketFacts(item.id, true)
      await owner.page.goto(origin + `/organizer/events/${eventId}/registrations/${item.id}`)
      await owner.page.getByRole('button', { name: 'Resend tickets', exact: true }).click()
      const dialog = owner.page.getByRole('dialog')
      await expect(dialog.getByText(item.recipient, { exact: true })).toBeVisible()
      expect(await dialog.locator('input[type=email]').count()).toBe(0)
      const existing = dbJson<{ id: string; requestId: string; state: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'requestId',request_id,'state',state)), '[]'::jsonb) from private.ticket_email_outbox where registration_id=${quote(item.id)} and purpose='resend';`)
      if (!existing.length) {
        await expect.poll(async () => await dialog.getByRole('button', { name: 'Confirm and resend', exact: true }).isVisible() || await dialog.getByRole('button', { name: 'Retry same request', exact: true }).isVisible()).toBe(true)
        const retained = await dialog.getByRole('button', { name: 'Retry same request', exact: true }).isVisible()
        if (!retained) {
          await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
          expect(dbJson<{ count: number }>(`select jsonb_build_object('count',count(*)) from private.ticket_email_outbox where registration_id=${quote(item.id)} and purpose='resend';`).count).toBe(0)
          await owner.page.getByRole('button', { name: 'Resend tickets', exact: true }).click()
        }
        // Await the real acknowledgement before the synchronous guarded SQL read.
        const acknowledgement = owner.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/rpc/request_ticket_email_resend') && response.request().postDataJSON()?.p_source_id === item.id)
        await dialog.getByRole('button', { name: retained ? 'Retry same request' : 'Confirm and resend', exact: true }).click()
        const response = await acknowledgement
        expect(response.ok()).toBe(true)
        expect(await response.json()).toMatchObject({kind:'queued'})
        await expect(dialog.getByRole('button', { name: 'Check status', exact: true })).toBeEnabled()
      }
      const request = dbJson<{ id: string; requestId: string; state: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'requestId',request_id,'state',state)), '[]'::jsonb) from private.ticket_email_outbox where registration_id=${quote(item.id)} and purpose='resend';`)
      expect(request).toHaveLength(1)
      if (!existing.length) expect(request[0].state).toBe('queued')
      await control({ action: 'email-mode', mode: item.mode })
      await control({ action: 'run-worker', name: 'ticket-email-worker' })
      await dialog.getByRole('button', { name: 'Check status', exact: true }).click()
      await expect(dialog.getByRole('heading', { name: item.title, exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: 'Back to registration', exact: true }).click()
      await owner.page.reload()
      await owner.page.getByRole('button', { name: 'Resend tickets', exact: true }).click()
      await expect(dialog.getByRole('heading', { name: item.title, exact: true })).toBeVisible()
      const after = dbJson<{ id: string; requestId: string; state: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'requestId',request_id,'state',state)), '[]'::jsonb) from private.ticket_email_outbox where registration_id=${quote(item.id)} and purpose='resend';`)
      expect(after).toHaveLength(1); expect(after[0].id).toBe(request[0].id); expect(after[0].requestId).toBe(request[0].requestId)
      expect(ticketFacts(item.id, true)).toEqual(beforeTickets)
      value.results['J04a' + item.mode] = after[0]; saveScenario(value)
      await dialog.getByRole('button', { name: 'Back to registration', exact: true }).click()
    }
    value.results.J04a = { failedAndUnknownKeptOriginalRequest: true, recipientReadOnly: true, noTicketMutation: true }
  } finally { await control({ action: 'email-mode', mode: 'accepted' }); await owner.close() }
}))

for (const mode of ['processing', 'failed', 'anomaly', 'commit_then_unknown'] as const) {
  test(`J05-${mode} refund boundary preserves one financial operation through reload and reconciliation`, async ({ browser }) => journey('J05-' + mode, async value => {
    const eventId = requireId(value.paidEventId, 'Principal paid event')
    const buyer = await realContext(browser, 'refund-control-' + mode)
    const owner = await realContext(browser, 'organizer')
    let ownsRefundMode=false
    try {
      const source = await separatePaidSource(buyer.page, value, eventId, 'refundSource-' + mode, emailFor(value, 'refund-' + mode))
      if (value.results['J05-' + mode]) return
      // Delivery of this source's initial receipt precedes refund/failure mode ownership.
      const retainedCheckpoint=value.results['refundCheckpoint-'+mode] as {refundId?:string}|undefined
      if(retainedCheckpoint?.refundId) {
        const canonical=financialSnapshot(source.orderId).operations
        expect(canonical).toHaveLength(1)
        retainedRefundId(canonical[0].stripe_refund_id,retainedCheckpoint.refundId,[])
      }
      const receipt=outboxRows(`purpose='initial' and order_id=${quote(source.orderId)}`)
      expect(receipt).toHaveLength(1)
      if(receipt[0].state!=='accepted')await exactEmailWorker(value,'refundInitialReceiptWorker-'+mode,{outboxId:receipt[0].id},'accepted')
      else verifyEmailReadback(value,'refundInitialReceiptWorker-'+mode,receipt[0])
      const accepted=outboxRows(`id=${quote(receipt[0].id)}`)[0]
      await acceptedMessage(accepted)
      value.results['refundInitialReceipt-'+mode]={outboxId:accepted.id,providerId:accepted.provider_id};saveScenario(value)
      await organizerLogin(owner.page, value)
      const checkpointKey='refundCheckpoint-'+mode
      type Checkpoint={original:ReturnType<typeof ticketFacts>;finance:FinancialSnapshot;providerRefundIds:string[];dispatchIntent?:boolean;initialUnknown?:{finance:FinancialSnapshot;refundId:string;capturedAt:string};observedFinance?:FinancialSnapshot;observedState?:string;initialStateObserved?:boolean;reconciled?:boolean;refundId?:string}
      let checkpoint=value.results[checkpointKey] as Checkpoint|undefined
      if(!checkpoint) {
        const finance=financialSnapshot(source.orderId)
        if(finance.operations.length)throw new Error('Refund baseline missing before original dispatch; do not reconstruct it')
        checkpoint={original:ticketFacts(source.orderId),finance,providerRefundIds:(await control<{stripe:{refundIds:string[]}}>({action:'state'})).stripe.refundIds}
        value.results[checkpointKey]=checkpoint;saveScenario(value)
      }
      const original=checkpoint.original,originalFinance=checkpoint.finance
      await owner.page.goto(origin + `/organizer/events/${eventId}/orders/${source.orderId}`)
      const stateBefore={stripe:{refundIds:checkpoint.providerRefundIds}}
      const existing = dbJson<{ key: string; refundId: string | null }[]>(`select coalesce(jsonb_agg(jsonb_build_object('key',idempotency_key,'refundId',stripe_refund_id)), '[]'::jsonb) from private.order_refund_operations where order_id=${quote(source.orderId)};`)
      const currentFinance=financialSnapshot(source.orderId)
      if(checkpoint.refundId) {expect(currentFinance.operations).toHaveLength(1);retainedRefundId(currentFinance.operations[0].stripe_refund_id,checkpoint.refundId,[])}
      if(currentFinance.order.status==='refunded'&&!checkpoint.reconciled) {
        if(!checkpoint.initialUnknown||!checkpoint.observedState||!checkpoint.observedFinance)throw new Error('Refund completed before unknown and observed-state evidence was retained; do not manufacture earlier proof')
        expect(currentFinance.operations).toHaveLength(1)
        expect(immutableOperation(currentFinance.operations[0])).toEqual(immutableOperation(checkpoint.observedFinance.operations[0]))
        checkpoint.reconciled=true;saveScenario(value)
      }
      ownsRefundMode=true
      await control({ action: 'refund-mode', mode })
      if (!existing.length) {
        if(checkpoint.dispatchIntent)throw new Error('Original refund dispatch unresolved; no replacement request')
        await owner.page.getByRole('button', { name: 'Refund order', exact: true }).click()
        const money = dbJson<{ total: number }>(`select jsonb_build_object('total',total_minor) from public.orders where id=${quote(source.orderId)};`).total
        await expect(owner.page.getByRole('dialog').getByRole('region', { name: 'Refund summary', exact: true }).locator('p').filter({ hasText: 'Whole order refund' }).locator('strong')).toHaveText(displayMoney(money))
        checkpoint.dispatchIntent=true;saveScenario(value)
        await owner.page.getByRole('button', { name: 'Confirm refund', exact: true }).click()
      }
      const observedState=mode==='failed'?'failed':mode==='anomaly'?'review':'processing'
      const heading=observedState==='failed'?'Refund failed':observedState==='review'?'Refund needs review':'Refund processing'
      if(!checkpoint.initialUnknown&&!checkpoint.reconciled)await expect(owner.page.getByRole('heading',{name:'Refund outcome unknown',exact:true}).first()).toBeVisible()
      const operationFinance=financialSnapshot(source.orderId)
      expect(operationFinance.operations).toHaveLength(1)
      const operation=operationFinance.operations[0]
      expect(operation.idempotency_key).toBe('whereto-refund-integrity-v1:'+source.orderId)
      expect(operation.snapshot).toEqual(expectedRefundSnapshot(originalFinance.order))
      const stateAfter=await control<{stripe:{refundIds:string[]}}>({action:'state'})
      const newRefunds=stateAfter.stripe.refundIds.filter(id=>!stateBefore.stripe.refundIds.includes(id))
      expect(newRefunds).toHaveLength(1)
      const refundId=retainedRefundId(operation.stripe_refund_id,checkpoint.refundId,newRefunds)
      expect(refundId).toBe(newRefunds[0])
      if(!refundId)throw new Error('Cannot identify the existing provider refund; no new financial dispatch allowed')
      if(checkpoint.initialUnknown) {
        expect(checkpoint.initialUnknown.refundId).toBe(refundId)
        expect(immutableOperation(operation)).toEqual(immutableOperation(checkpoint.initialUnknown.finance.operations[0]))
      }
      checkpoint.refundId=refundId
      value.results['refundControl-'+mode]={orderId:source.orderId,refundId,operationKey:operation.idempotency_key};saveScenario(value)
      if(!checkpoint.initialUnknown) {
        expect(operation.state).toBe('unknown')
        expect(operation.stripe_refund_id).toBeNull()
        await expect(owner.page.getByRole('heading',{name:'Refund outcome unknown',exact:true}).first()).toBeVisible()
        expect(operationFinance.order).toEqual(originalFinance.order)
        expect(operationFinance.items).toEqual(originalFinance.items)
        expect(operationFinance.tickets).toEqual(originalFinance.tickets)
        expect(operationFinance.refunds).toEqual(originalFinance.refunds)
        checkpoint.initialUnknown={finance:operationFinance,refundId,capturedAt:new Date().toISOString()};saveScenario(value)
      }
      if(!checkpoint.observedState&&!checkpoint.reconciled) {
        // A fresh reload closes the completed dialog and proves durable unknown before reconciliation.
        await owner.page.reload()
        await expect(owner.page.getByRole('heading',{name:'Refund outcome unknown',exact:true}).first()).toBeVisible()
        expect(financialSnapshot(source.orderId)).toEqual(checkpoint.initialUnknown.finance)
        expect(await owner.page.getByRole('button',{name:'Refund order',exact:true}).count()).toBe(0)
        await checkExistingRefund(owner.page,eventId,source.orderId,observedState)
        await expect(owner.page.getByRole('heading',{name:heading,exact:true}).first()).toBeVisible()
        const observed=financialSnapshot(source.orderId)
        expectRefundObservationPreservation(checkpoint.initialUnknown.finance,observed)
        expect(observed.operations[0].state).toBe(observedState)
        expect(observed.operations[0].stripe_refund_id).toBe(mode==='anomaly'?null:refundId)
        expect((await control<{stripe:{refundIds:string[]}}>({action:'state'})).stripe.refundIds).toEqual(stateAfter.stripe.refundIds)
        checkpoint.observedFinance=observed;checkpoint.observedState=observedState;saveScenario(value)
      }
      if(!checkpoint.observedFinance||checkpoint.observedState!==observedState)throw new Error('Original observation proof is missing; do not reconstruct it')
      const observedFinance=checkpoint.observedFinance
      if(!checkpoint.reconciled) {
        expect(ticketFacts(source.orderId)).toEqual(original)
        await owner.page.reload()
        await expect(owner.page.getByRole('heading',{name:heading,exact:true}).first()).toBeVisible()
        expect(await owner.page.getByRole('button',{name:'Refund order',exact:true}).count()).toBe(0)
        expect(financialSnapshot(source.orderId)).toEqual(observedFinance)
      }
      if (mode === 'processing' || mode === 'commit_then_unknown') {
        if(!checkpoint.reconciled) {
        await control({ action: 'refund-mode', mode: 'succeeded', refundId })
        await control({ action: 'refund-mode', mode: 'succeeded' })
        await checkExistingRefund(owner.page,eventId,source.orderId,'processing')
        const ready=financialSnapshot(source.orderId)
        expectRefundObservationPreservation(observedFinance,ready)
        expect(ready.operations[0].stripe_refund_id).toBe(refundId)
        expect(ready.operations[0].state).toBe('processing')
        await control({ action: 'stripe-event', type: 'refund.updated', objectId: refundId })
        await owner.page.reload()
        await expect(owner.page.getByText('Refund complete', { exact: true }).first()).toBeVisible()
        checkpoint.reconciled=true;saveScenario(value)
        }
        const after = ticketFacts(source.orderId)
        expect(after.map(ticket => ticket.id)).toEqual(original.map(ticket => ticket.id))
        expect(after.map(ticket => ticket.credentialHash)).toEqual(original.map(ticket => ticket.credentialHash))
        expect(after.every(ticket => ticket.status === 'refunded')).toBe(true)
        const beforeNoticeFailure = financialSnapshot(source.orderId)
        expect(beforeNoticeFailure.operations).toHaveLength(1)
        expect(beforeNoticeFailure.operations[0].stripe_refund_id).toBe(refundId)
        expect(immutableOperation(beforeNoticeFailure.operations[0])).toEqual(immutableOperation(observedFinance.operations[0]))
        const failedNotice=await exactRefundNotice(value,'refundNoticeWorker-'+mode,source.orderId,'failed')
        expect(failedNotice.state).toBe('failed');expect(failedNotice.dispatch_count).toBe(1)
        value.results['refundFailedNotice-'+mode]={outboxId:failedNotice.id,orderId:source.orderId};saveScenario(value)
        await owner.page.reload()
        await expect(owner.page.getByText('Refund complete', { exact: true }).first()).toBeVisible()
        expect(financialSnapshot(source.orderId)).toEqual(beforeNoticeFailure)
      } else {
        expect(ticketFacts(source.orderId)).toEqual(original)
        expect(financialSnapshot(source.orderId)).toEqual(observedFinance)
      }
      const final = await control<{ stripe: { refundIds: string[] } }>({ action: 'state' })
      expect(final.stripe.refundIds).toEqual(stateAfter.stripe.refundIds)
      expect(dbJson<{ count: number }>(`select jsonb_build_object('count',count(*)) from private.order_refund_operations where order_id=${quote(source.orderId)};`).count).toBe(1)
      value.results['J05-' + mode] = { orderId: source.orderId, sameRefundId: refundId, oneOperation: true, noReplacementAfterReload: true }
    } finally {
      if(ownsRefundMode) {await control({ action: 'refund-mode', mode: 'succeeded' }); await control({ action: 'email-mode', mode: 'accepted' })}
      await buyer.close(); await owner.close()
    }
  }))
}

test('J04b multi-source recovery links enforce membership and cannot act as other private purposes', async ({ browser }) => journey('J04b', async value => {
  const owner = await realContext(browser, 'organizer')
  const additionalBuyer = await realContext(browser, 'recovery-extra-source')
  const recipient = emailFor(value, 'free')
  const recovery = await realContext(browser, 'multi-source-recovery')
  try {
    await organizerLogin(owner.page, value)
    const extraEvent = await eventThroughUi(owner.page, value, 'recoveryFree', 'free')
    const extra = await separateFreeSource(additionalBuyer.page, value, extraEvent, 'recoveryExtraSource', recipient)
    await recovery.page.goto(origin + '/tickets/recover')
    await recovery.page.getByLabel('Email address', { exact: true }).fill(recipient)
    await recovery.page.getByRole('button', { name: 'Send me my tickets', exact: true }).click()
    await expect(recovery.page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible()
    await control({ action: 'email-mode', mode: 'accepted' })
    await control({ action: 'run-worker', name: 'ticket-email-worker' })
    const delivery = await acceptedRecoveryDelivery(recovery.page)
    const grantUrl = delivery.url
    value.results.J04bRecoveryDelivery = delivery
    value.results.multiSourceRecoveryUrl = grantUrl; saveScenario(value)
    await privateGoto(recovery.page, grantUrl)
    const links = recovery.page.locator('.delivery-index-list a')
    await expect(links).toHaveCount(2)
    const hrefs = await links.evaluateAll(nodes => nodes.map(node => (node as HTMLAnchorElement).getAttribute('href')!))
    for (const href of hrefs) {
      await privateGoto(recovery.page, origin + href)
      await expect(recovery.page.locator('.buyer-wallet-row')).toHaveCount(3)
    }
    await recovery.page.goto(origin + '/ticket-access?member=999')
    await expect(recovery.page.getByText(/unavailable|not.*included|could not/i).first()).toBeVisible()
    expect(await recovery.page.locator('.buyer-wallet-row').count()).toBe(0)
    const token = new URL(grantUrl).hash
    for (const purpose of ['refund-details', 'event-status']) {
      await privateGoto(recovery.page, origin + '/' + purpose + token)
      await expect(recovery.page.getByText(/unavailable|not valid|could not/i).first()).toBeVisible()
      expect(await recovery.page.getByLabel('Admission QR code', { exact: true }).count()).toBe(0)
    }
    const outsider = await realContext(browser, 'grant-missing-control')
    try {
      await outsider.page.goto(origin + '/ticket-access?member=1')
      await expect(outsider.page.getByText(/unavailable|not valid|could not/i).first()).toBeVisible()
      expect(await outsider.page.locator('.buyer-wallet-row').count()).toBe(0)
    } finally { await outsider.close() }
    value.results.J04b = { extraEventId: extraEvent, extraRegistrationId: extra.registrationId, collections: 2, membershipAndPurposeDenied: true }
  } finally { await owner.close(); await additionalBuyer.close(); await recovery.close() }
}))

test('J04c separate expired and revoked grants deny access while original collection stays intact', async ({ browser }) => journey('J04c', async value => {
  const registrationId = requireId(value.freeRegistrationId, 'Principal free registration')
  const before = ticketFacts(registrationId, true)
  const negative = await realContext(browser, 'negative-grants')
  const recipient = emailFor(value, 'free-reverse')
  const expectFreshUnavailableGrant = async (grantUrl: string) => {
    // Fragment-only navigation can retain a previously loaded wallet. Each denial needs a fresh reader.
    const reader = await negative.context.newPage()
    try {
      const token = new URL(grantUrl).hash.slice(1)
      const denied = reader.waitForResponse(response => {
        const request = response.request()
        return request.frame() === reader.mainFrame() && request.method() === 'POST'
          && new URL(response.url()).pathname === '/functions/v1/ticket-email-access'
          && request.postDataJSON()?.token === token && request.postDataJSON()?.page === 0
      }, { timeout: 40_000 }).then(response => response.status())
      const [status] = await Promise.all([denied, privateGoto(reader, grantUrl)])
      expect(status).toBe(404)
      await expect(reader.getByRole('heading', { name: 'Ticket link unavailable', exact: true })).toBeVisible()
      await expect(reader.locator('.buyer-wallet-row')).toHaveCount(0)
      await expect(reader.getByLabel('Admission QR code', { exact: true })).toHaveCount(0)
    } finally { await reader.close() }
  }
  try {
    const expired = negativeGrant({ action: 'expired', alias: 'j04-expired' })
    if (!expired.token) throw new Error('Expired negative grant evidence is missing its original private proof')
    await privateGoto(negative.page, origin + '/ticket-access#' + expired.token)
    await expect(negative.page.getByText(/unavailable|expired|not valid|could not/i).first()).toBeVisible()
    expect(await negative.page.locator('.buyer-wallet-row').count()).toBe(0)
    let revokedUrl = value.results.revokedNegativeGrantUrl
    if (typeof revokedUrl !== 'string') {
      const row=await exactRecoveryRequest(negative.page,value,'J04cRetainedRecovery',recipient)
      if(row.state!=='accepted')await exactEmailWorker(value,'J04cRecoveryWorker',{outboxId:row.id},'accepted')
      else verifyEmailReadback(value,'J04cRecoveryWorker',row)
      const delivery = await acceptedRecoveryDelivery(negative.page)
      revokedUrl = delivery.url
      value.results.J04cRecoveryDelivery = delivery
      value.results.revokedNegativeGrantUrl = revokedUrl; saveScenario(value)
    }
    const url = revokedUrl as string
    if (!value.results.J04cRevoked) {
      await privateGoto(negative.page, url)
      await expect(negative.page.locator('.buyer-wallet-row')).toHaveCount(3)
      const revoke = negativeGrant({ action: 'revoke', alias: 'j04-revoked', token: new URL(url).hash.slice(1) })
      value.results.J04cRevoked = { grantId: revoke.grantId, evidence: revoke.evidence }; saveScenario(value)
    }
    await expectFreshUnavailableGrant(url)
    // Actual information-only provider deliveries must not become admission grants.
    const infoMessages = (await inbox()).messages.filter(message => /\/(refund-details|event-status)[#?]/.test((message.payload.html ?? '') + (message.payload.text ?? '')))
    if (!infoMessages.length) throw new Error('J05/J06 must first produce a real information-only delivery for wrong-purpose proof')
    for (const message of infoMessages.slice(-2)) {
      const infoUrl = messageLink(message)
      await expectFreshUnavailableGrant(origin + '/ticket-access' + new URL(infoUrl).hash)
    }
    await privateGoto(negative.page, value.freeBuyerUrl!)
    await expect(negative.page.locator('.buyer-wallet-row')).toHaveCount(3)
    expect(ticketFacts(registrationId, true)).toEqual(before)
    value.results.J04c = { expiredEvidence: expired.evidence, separateRecoveryGrantRevoked: true, originalCollectionPreserved: true, informationPurposeCannotAdmit: true }
  } finally { await negative.close() }
}))

test('J06a late signed payment after UI cancellation keeps original order under review without tickets', async ({ browser }) => journey('J06a', async value => {
  const owner = await realContext(browser, 'organizer')
  const buyer = await realContext(browser, 'late-payment-buyer')
  try {
    await organizerLogin(owner.page, value)
    const savedEvent = value.events?.latePayment?.id
    const eventId = savedEvent && dbJson<{ status: string }>(`select jsonb_build_object('status',status) from public.events where id=${quote(savedEvent)};`).status === 'cancelled'
      ? savedEvent : await eventThroughUi(owner.page, value, 'latePayment', 'paid')
    const recipient = emailFor(value, 'late-payment')
    if (!value.results.latePaymentHostedUrl) {
      const checkoutUrl = value.results.latePaymentCheckoutUrl
      if (typeof checkoutUrl === 'string') await privateGoto(buyer.page, checkoutUrl)
      else {
        await discover(buyer.page, eventId)
        await buyer.page.getByLabel('General Admission quantity', { exact: true }).fill('2')
        await buyer.page.getByLabel('VIP quantity', { exact: true }).fill('1')
        await continueToCheckout(buyer.page)
        value.results.latePaymentCheckoutUrl = buyer.page.url(); saveScenario(value)
      }
      await expect.poll(async () => await buyer.page.getByLabel('Your name', { exact: true }).isVisible() || await buyer.page.getByRole('button', { name: 'Complete simulated payment', exact: true }).isVisible()).toBe(true)
      if (await buyer.page.getByLabel('Your name', { exact: true }).isVisible()) {
        await buyer.page.getByLabel('Your name', { exact: true }).fill('Late Payment Guest')
        await buyer.page.getByLabel('Email address', { exact: true }).fill(recipient)
        await buyer.page.getByRole('button', { name: 'Continue to secure payment', exact: true }).click()
      }
      await expect(buyer.page.getByRole('button', { name: 'Complete simulated payment', exact: true })).toBeVisible()
      value.results.latePaymentHostedUrl = buyer.page.url(); saveScenario(value)
    }
    const orders = dbJson<{ id: string; sessionId: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'sessionId',stripe_checkout_session_id)), '[]'::jsonb) from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(recipient)};`)
    expect(orders).toHaveLength(1)
    const order = orders[0]
    if (!order.sessionId) throw new Error('Original late-payment order has no attached provider session; refusing replacement')
    await owner.page.goto(origin + `/organizer/events/${eventId}/cancellation`)
    if (dbJson<{ status: string }>(`select jsonb_build_object('status',status) from public.events where id=${quote(eventId)};`).status !== 'cancelled') {
      await owner.page.getByRole('button', { name: 'Cancel event', exact: true }).click()
      await owner.page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click()
    }
    await expect(owner.page.getByRole('heading', { name: 'Event cancelled', exact: true })).toBeVisible()
    expect(ticketFacts(order.id)).toHaveLength(0)
    const completion = await control<{ successUrl: string }>({ action: 'checkout-complete', sessionId: order.sessionId })
    value.results.latePaymentReturnUrl = completion.successUrl; saveScenario(value)
    await privateGoto(buyer.page, completion.successUrl)
    await expect(buyer.page.getByText(/review|checking|needs attention/i).first()).toBeVisible()
    const result = dbJson<{ status: string; sessionId: string; count: number }>(`select jsonb_build_object('status',status,'sessionId',stripe_checkout_session_id,'count',(select count(*) from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(recipient)})) from public.orders where id=${quote(order.id)};`)
    expect(result).toEqual({ status: 'requires_review', sessionId: order.sessionId, count: 1 })
    expect(ticketFacts(order.id)).toHaveLength(0)
    await control({ action: 'checkout-complete', sessionId: order.sessionId })
    expect(ticketFacts(order.id)).toHaveLength(0)
    value.results.J06a = { eventId, orderId: order.id, originalSessionId: order.sessionId, canonicalStatus: result.status, duplicateWebhookIssuedNoTickets: true }
  } finally { await owner.close(); await buyer.close() }
}))

for (const free of [false, true]) {
  test(`J08-admission-${free ? 'free' : 'paid'} committed writer reply loss rechecks the same ticket without another write`, async ({ browser }) => journey('J08-admission-' + (free ? 'free' : 'paid'), async value => {
    const owner = await realContext(browser, 'organizer')
    const buyer = await realContext(browser, 'admission-unknown-' + (free ? 'free' : 'paid'))
    try {
      const eventId = requireId(free ? value.freeEventId : value.paidEventId, 'Principal event')
      const source = free
        ? await separateFreeSource(buyer.page, value, eventId, 'admissionUnknownFree', emailFor(value, 'admission-free'))
        : await separatePaidSource(buyer.page, value, eventId, 'admissionUnknownPaid', emailFor(value, 'admission-paid'))
      const sourceId = 'registrationId' in source ? source.registrationId : source.orderId
      const before = ticketFacts(sourceId, free)
      expect(before).toHaveLength(3)
      const selected = before[1]
      await organizerLogin(owner.page, value)
      const path = free ? `registrations/${sourceId}/${selected.id}` : `${sourceId}/${selected.id}`
      await owner.page.goto(origin + `/organizer/events/${eventId}/check-in/find/${path}`)
      const resultKey = 'J08Admission' + (free ? 'Free' : 'Paid')
      if (!value.results[resultKey]) {
        if (selected.status === 'used') throw new Error('Admission committed before evidence was saved; retain original and inspect this attempt instead of dispatching again')
        let writes = 0
        const pattern = '**/rest/v1/rpc/redeem_owned_ticket'
        await owner.page.route(pattern, async route => {
          writes++
          const response = await route.fetch()
          if (!response.ok()) throw new Error('Admission writer failed before the committed reply-loss control')
          await route.abort('failed')
        }, { times: 1 })
        await owner.page.getByRole('button', { name: 'Check in guest', exact: true }).click()
        await owner.page.getByRole('dialog').getByRole('button', { name: 'Admit guest', exact: true }).click()
        await expect(owner.page.getByRole('button', { name: 'Recheck ticket status', exact: true })).toBeVisible()
        const committed = ticketFacts(sourceId, free)
        expect(committed[1].status).toBe('used')
        value.results[resultKey] = { sourceId, ticketId: selected.id, usedAt: committed[1].usedAt, committedReplyLost: true }; saveScenario(value)
        await owner.page.getByRole('button', { name: 'Recheck ticket status', exact: true }).click()
        await expect(owner.page.getByRole('heading', { name: 'Already checked in', exact: true })).toBeVisible()
        expect(writes).toBe(1)
        expect(ticketFacts(sourceId, free)).toEqual(committed)
      } else await expect(owner.page.getByRole('heading', { name: 'Already checked in', exact: true })).toBeVisible()
      await owner.page.reload()
      await expect(owner.page.getByRole('heading', { name: 'Already checked in', exact: true })).toBeVisible()
      const after = ticketFacts(sourceId, free)
      expect(after[0].status).toBe('valid'); expect(after[2].status).toBe('valid')
      expect(after.map(ticket => ticket.id)).toEqual(before.map(ticket => ticket.id))
      expect(after.map(ticket => ticket.credentialHash)).toEqual(before.map(ticket => ticket.credentialHash))
    } finally { await owner.close(); await buyer.close() }
  }))
}

test('J08c provider commits checkout before transport loss, then original UI retry attaches the same session', async ({ browser }) => journey('J08c', async value => {
  const eventId = requireId(value.paidEventId, 'Principal paid event')
  const buyer = await realContext(browser, 'checkout-provider-unknown')
  const recipient = emailFor(value, 'checkout-provider-unknown')
  try {
    if (value.results.J08c) return
    let checkoutUrl = value.results.providerUnknownCheckoutUrl
    if (typeof checkoutUrl === 'string') await privateGoto(buyer.page, checkoutUrl)
    else {
      await discover(buyer.page, eventId)
      await buyer.page.getByLabel('General Admission quantity', { exact: true }).fill('2')
      await buyer.page.getByLabel('VIP quantity', { exact: true }).fill('1')
      await continueToCheckout(buyer.page)
      checkoutUrl = buyer.page.url(); value.results.providerUnknownCheckoutUrl = checkoutUrl; saveScenario(value)
    }
    if (!value.results.providerUnknownSessionId) {
      const before = await control<{ stripe: { checkoutSessionIds: string[] } }>({ action: 'state' })
      await control({ action: 'checkout-mode', mode: 'commit_then_unknown' })
      await buyer.page.getByLabel('Your name', { exact: true }).fill('Provider Unknown Guest')
      await buyer.page.getByLabel('Email address', { exact: true }).fill(recipient)
      await buyer.page.getByRole('button', { name: 'Continue to secure payment', exact: true }).click()
      await expect(buyer.page.getByRole('heading', { name: 'Unable to confirm payment', exact: true })).toBeVisible()
      const after = await control<{ stripe: { checkoutSessionIds: string[] } }>({ action: 'state' })
      const created = after.stripe.checkoutSessionIds.filter(id => !before.stripe.checkoutSessionIds.includes(id))
      expect(created).toHaveLength(1)
      value.results.providerUnknownSessionId = created[0]
      value.results.providerUnknownOriginalAttempt = await buyer.page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith('whereto.checkout-attempt.v1:'))))
      saveScenario(value)
    }
    await control({ action: 'checkout-mode', mode: 'normal' })
    await buyer.page.reload()
    const check = buyer.page.getByRole('button', { name: 'Check status', exact: true })
    await expect.poll(async () => await check.isVisible() || await buyer.page.getByRole('button', { name: /^(Re-enter original details|Retry same checkout)$/ }).isVisible()).toBe(true)
    if (await check.isVisible()) await check.click()
    const retry = buyer.page.getByRole('button', { name: /^(Re-enter original details|Retry same checkout)$/ })
    await expect(retry).toBeEnabled(); await retry.click()
    if (await buyer.page.getByLabel('Your name', { exact: true }).isVisible()) {
      await buyer.page.getByLabel('Your name', { exact: true }).fill('Provider Unknown Guest')
      await buyer.page.getByLabel('Email address', { exact: true }).fill(recipient)
      await buyer.page.getByRole('button', { name: 'Retry same checkout', exact: true }).click()
    }
    await expect(buyer.page.getByRole('button', { name: 'Complete simulated payment', exact: true })).toBeVisible()
    expect(new URL(buyer.page.url()).pathname.split('/').at(-1)).toBe(value.results.providerUnknownSessionId)
    const orders = dbJson<{ id: string; sessionId: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'sessionId',stripe_checkout_session_id)), '[]'::jsonb) from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(recipient)};`)
    expect(orders).toHaveLength(1); expect(orders[0].sessionId).toBe(value.results.providerUnknownSessionId)
    await buyer.page.getByRole('button', { name: 'Complete simulated payment', exact: true }).click()
    value.results.providerUnknownCollectionUrl = await collection(buyer.page)
    expect(ticketFacts(orders[0].id)).toHaveLength(3)
    value.results.J08c = { orderId: orders[0].id, originalProviderSessionId: orders[0].sessionId, oneCanonicalOrder: true }
  } finally { await control({ action: 'checkout-mode', mode: 'normal' }); await buyer.close() }
}))

test('J07a unsaved profile and stale version require explicit review before applying the retained draft', async ({ browser }) => journey('J07a', async value => {
  const owner = await realContext(browser, 'organizer')
  const concurrent = await owner.context.newPage()
  try {
    await organizerLogin(owner.page, value)
    await owner.page.goto(origin + '/organizer/settings/profile')
    await owner.page.getByLabel(/^Bio/).fill('Retained draft ' + value.runId)
    await owner.page.getByRole('link', { name: /^Account & Security/ }).click()
    await expect(owner.page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true })).toBeVisible()
    await owner.page.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(owner.page.getByLabel(/^Bio/)).toHaveValue('Retained draft ' + value.runId)
    await concurrent.goto(origin + '/organizer/settings/profile')
    await concurrent.getByLabel(/^Bio/).fill('Concurrent saved bio ' + value.runId)
    await concurrent.getByRole('button', { name: 'Save profile', exact: true }).click()
    await expect(concurrent.getByText('Organizer profile saved.', { exact: true })).toBeVisible()
    await owner.page.getByRole('button', { name: 'Save profile', exact: true }).click()
    await expect(owner.page.getByRole('button', { name: 'Review latest saved profile', exact: true })).toBeVisible()
    await expect(owner.page.getByLabel(/^Bio/)).toHaveValue('Retained draft ' + value.runId)
    await expect(owner.page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled()
    await owner.page.getByRole('button', { name: 'Review latest saved profile', exact: true }).click()
    await expect(owner.page.getByText('Concurrent saved bio ' + value.runId, { exact: true })).toBeVisible()
    await owner.page.getByRole('button', { name: 'Keep my draft for the reviewed version', exact: true }).click()
    await owner.page.getByRole('button', { name: 'Save profile', exact: true }).click()
    await expect(owner.page.getByText('Organizer profile saved.', { exact: true })).toBeVisible()
    await owner.page.reload()
    await expect(owner.page.getByLabel(/^Bio/)).toHaveValue('Retained draft ' + value.runId)
    value.results.J07a = { staleProfileRejected: true, explicitReviewBeforeDraftApply: true, unsavedNavigationGuard: true }
  } finally { await concurrent.close(); await owner.close() }
}))

test('J06b stale published event inputs cannot overwrite a newer saved revision', async ({ browser }) => journey('J06b', async value => {
  const eventId = requireId(value.events?.recoveryFree?.id, 'J04b explicitly separate recovery event')
  const owner = await realContext(browser, 'organizer')
  const concurrent = await owner.context.newPage()
  try {
    await organizerLogin(owner.page, value)
    await owner.page.goto(origin + `/organizer/events/${eventId}/edit`)
    await owner.page.getByRole('button', { name: 'Continue to date & location', exact: true }).click()
    await owner.page.getByLabel('Venue name', { exact: true }).fill('Retained stale venue ' + value.runId)
    await concurrent.goto(origin + `/organizer/events/${eventId}/edit`)
    await concurrent.getByRole('button', { name: 'Continue to date & location', exact: true }).click()
    await concurrent.getByLabel('Venue name', { exact: true }).fill('Canonical concurrent venue ' + value.runId)
    await concurrent.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect.poll(() => dbJson<{ venue: string }>(`select jsonb_build_object('venue',venue_name) from public.events where id=${quote(eventId)};`).venue).toBe('Canonical concurrent venue ' + value.runId)
    const afterConcurrent = dbJson<{ version: string; venue: string }>(`select jsonb_build_object('version',updated_at,'venue',venue_name) from public.events where id=${quote(eventId)};`)
    await owner.page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(owner.page.getByRole('heading', { name: 'This event changed elsewhere', exact: true })).toBeVisible()
    await expect(owner.page.getByLabel('Venue name', { exact: true })).toHaveValue('Retained stale venue ' + value.runId)
    expect(dbJson<{ version: string; venue: string }>(`select jsonb_build_object('version',updated_at,'venue',venue_name) from public.events where id=${quote(eventId)};`)).toEqual(afterConcurrent)
    await owner.page.getByRole('button', { name: 'Reload saved version', exact: true }).click()
    await owner.page.getByRole('button', { name: 'Discard inputs and reload', exact: true }).click()
    await expect(owner.page.getByLabel('Venue name', { exact: true })).toHaveValue('Canonical concurrent venue ' + value.runId)
    value.results.J06b = { eventId, staleWriteRejected: true, canonicalVersion: afterConcurrent.version, retainedDraftThenExplicitReload: true }
  } finally { await concurrent.close(); await owner.close() }
}))

test('J02a paid QR first then manual duplicate keeps original selected ticket Used time', async ({ browser }) => journey('J02a', async value => {
  const eventId = requireId(value.paidEventId, 'Principal paid event')
  const buyer = await realContext(browser, 'paid-qr-first')
  const owner = await realContext(browser, 'organizer')
  try {
    const source = await separatePaidSource(buyer.page, value, eventId, 'paidQrFirstSource', emailFor(value, 'paid-qr-first'))
    const before = ticketFacts(source.orderId)
    if (!value.results.paidQrFirstImage) {
      value.results.paidQrFirstImage = await ticketQr(buyer.page, source.collectionUrl, 1)
      value.results.paidQrFirstTicketId = new URL(buyer.page.url()).pathname.split('/').at(-1)!
      saveScenario(value)
    }
    const selectedId = value.results.paidQrFirstTicketId as string
    const selected = before.find(ticket => ticket.id === selectedId)
    expect(selected).toBeDefined()
    await organizerLogin(owner.page, value)
    await qrCamera(owner.page, value.results.paidQrFirstImage as string)
    await owner.page.goto(origin + `/organizer/events/${eventId}/check-in/scan`)
    await expect(owner.page.getByRole('heading', { name: selected!.status === 'used' ? 'Already scanned' : 'Admitted', exact: true })).toBeVisible()
    const committed = ticketFacts(source.orderId)
    expect(committed.filter(ticket => ticket.status === 'used')).toHaveLength(1)
    const used = committed.find(ticket => ticket.id === selectedId)!
    expect(used.status).toBe('used')
    await manual(owner.page, eventId, source.orderId, selectedId, false)
    await expect(owner.page.getByRole('heading', { name: 'Already checked in', exact: true })).toBeVisible()
    expect(ticketFacts(source.orderId)).toEqual(committed)
    expect(committed.map(ticket => ticket.id)).toEqual(before.map(ticket => ticket.id))
    expect(committed.map(ticket => ticket.credentialHash)).toEqual(before.map(ticket => ticket.credentialHash))
    value.results.J02a = { orderId: source.orderId, selectedTicketId: selectedId, usedAt: used.usedAt, oneUsedTicket: true }
  } finally { await owner.close(); await buyer.close() }
}))

test('J04d refunded and cancelled sources refuse resend and neutral recovery sends no new access', async ({ browser }) => journey('J04d', async value => {
  const owner = await realContext(browser, 'organizer')
  try {
    await organizerLogin(owner.page, value)
    const cancelled = value.results.cancellationFreeSource as { registrationId: string }
    const cases = [
      { eventId: requireId(value.paidEventId, 'Paid event'), sourceId: requireId(value.paidOrderId, 'Refunded order'), free: false, recipient: emailFor(value, 'paid') },
      { eventId: requireId(value.events?.cancellationFree?.id, 'Cancelled free event'), sourceId: requireId(cancelled?.registrationId, 'Cancelled registration'), free: true, recipient: emailFor(value, 'cancellation-free') },
    ]
    for (const item of cases) {
      const recovery=await realContext(browser,'inactive-recovery-'+(item.free?'free':'paid'))
      try {
      const before = ticketFacts(item.sourceId, item.free)
      const countBefore = dbJson<{ count: number }>(`select jsonb_build_object('count',count(*)) from private.ticket_email_outbox where ${item.free ? 'registration_id' : 'order_id'}=${quote(item.sourceId)} and purpose='resend';`).count
      await owner.page.goto(origin + `/organizer/events/${item.eventId}/${item.free ? 'registrations' : 'orders'}/${item.sourceId}`)
      if (item.free) expect(await owner.page.getByRole('button', { name: 'Refund order', exact: true }).count()).toBe(0)
      if (item.free) {
        await owner.page.getByRole('button', { name: 'Resend tickets', exact: true }).click()
        await expect(owner.page.getByRole('heading', { name: 'Cannot resend tickets', exact: true })).toBeVisible()
      } else {
        await expect(owner.page.getByRole('heading', { name: 'Refund complete', exact: true })).toBeVisible()
        const resend = owner.page.getByRole('button', { name: 'Resend tickets', exact: true })
        await expect(resend).toBeDisabled()
        await expect(resend).toHaveAttribute('aria-describedby', 'refund-resend-explanation')
        await expect(owner.page.locator('#refund-resend-explanation')).toHaveText('Tickets cannot be resent while this order is refunded, unavailable, or awaiting refund verification.')
      }
      expect(await owner.page.getByRole('button', { name: 'Confirm and resend', exact: true }).count()).toBe(0)
      expect(dbJson<{ count: number }>(`select jsonb_build_object('count',count(*)) from private.ticket_email_outbox where ${item.free ? 'registration_id' : 'order_id'}=${quote(item.sourceId)} and purpose='resend';`).count).toBe(countBefore)
      const inboxBefore = (await inbox()).messages.filter(message => JSON.stringify(message.payload.to).includes(item.recipient) && /\/ticket-access#/.test((message.payload.html ?? '') + (message.payload.text ?? ''))).length
      const row=await exactRecoveryRequest(recovery.page,value,'J04dRecovery-'+(item.free?'free':'paid'),item.recipient)
      if(row.state==='suppressed')verifyEmailReadback(value,'J04dWorker-'+(item.free?'free':'paid'),row)
      const finished=row.state==='suppressed'?row:await exactEmailWorker(value,'J04dWorker-'+(item.free?'free':'paid'),{outboxId:row.id},'accepted')
      expect(finished.state).toBe('suppressed')
      const exact=outboxRows(`id=${quote(row.id)}`)[0] as OutboxRow & {grant_id:string|null;dispatch_stopped_reason:string|null}
      expect(exact.grant_id).toBeNull();expect(exact.dispatch_stopped_reason).toBe('no_matching_sources');expect(exact.dispatch_count).toBe(0)
      const accessAfter = (await inbox()).messages.filter(message => JSON.stringify(message.payload.to).includes(item.recipient) && /\/ticket-access#/.test((message.payload.html ?? '') + (message.payload.text ?? '')))
      expect(accessAfter.length).toBe(inboxBefore)
      expect(ticketFacts(item.sourceId, item.free)).toEqual(before)
      } finally {await recovery.close()}
    }
    value.results.J04d = { inactiveResendDenied: true, neutralRecoveryNoNewAccess: true, freeRefundAbsent: true }
  } finally { await owner.close() }
}))

test('J08d verified unpaid cancellation permits selection reset without replacing the original order', async ({ browser }) => journey('J08d', async value => {
  const buyer = await realContext(browser, 'unpaid-cancellation')
  const eventId = requireId(value.paidEventId, 'Principal paid event')
  const recipient = emailFor(value, 'unpaid-cancellation')
  try {
    if (value.results.J08d) return
    let checkout = value.results.unpaidCancellationCheckoutUrl
    if (typeof checkout === 'string') await privateGoto(buyer.page, checkout)
    else {
      await discover(buyer.page, eventId)
      await buyer.page.getByLabel('General Admission quantity', { exact: true }).fill('1')
      await continueToCheckout(buyer.page)
      checkout = buyer.page.url(); value.results.unpaidCancellationCheckoutUrl = checkout; saveScenario(value)
    }
    await expect.poll(async () => await buyer.page.getByLabel('Your name', { exact: true }).isVisible() || await buyer.page.getByRole('button', { name: 'Cancel checkout', exact: true }).isVisible() || await buyer.page.getByRole('heading', { name: 'Checkout cancelled', exact: true }).isVisible()).toBe(true)
    if (await buyer.page.getByLabel('Your name', { exact: true }).isVisible()) {
      await buyer.page.getByLabel('Your name', { exact: true }).fill('Unpaid Cancellation Guest')
      await buyer.page.getByLabel('Email address', { exact: true }).fill(recipient)
      await buyer.page.getByRole('button', { name: 'Continue to secure payment', exact: true }).click()
    }
    if (!await buyer.page.getByRole('heading', { name: 'Checkout cancelled', exact: true }).isVisible()) {
      await buyer.page.getByRole('button', { name: 'Cancel checkout', exact: true }).click()
    }
    await expect(buyer.page.getByRole('heading', { name: 'Checkout cancelled', exact: true })).toBeVisible()
    const orders = dbJson<{ id: string; status: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status)), '[]'::jsonb) from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(recipient)};`)
    expect(orders).toHaveLength(1); expect(['cancelled', 'expired']).toContain(orders[0].status)
    expect(ticketFacts(orders[0].id)).toHaveLength(0)
    await buyer.page.getByRole('link', { name: 'Choose tickets', exact: true }).click()
    await expect(buyer.page.getByLabel('General Admission quantity', { exact: true })).toBeVisible()
    expect(dbJson<{ count: number }>(`select jsonb_build_object('count',count(*)) from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(recipient)};`).count).toBe(1)
    value.results.J08d = { orderId: orders[0].id, terminalStatus: orders[0].status, verifiedSelectionReset: true, noReplacementOrder: true }
  } finally { await buyer.close() }
}))

test('J08e complete checkout proof loss cannot recover an old attempt and never authorizes a replacement', async ({ browser }) => journey('J08e', async value => {
  const eventId = requireId(value.paidEventId, 'Principal paid event')
  const recorded = value.results.J08c as { orderId: string } | undefined
  const original = requireId(recorded?.orderId, 'J08c original provider-unknown order')
  const lost = await realContext(browser, 'complete-proof-loss')
  let creates = 0
  lost.context.on('request', request => { if (new URL(request.url()).pathname.endsWith('/stripe-create-checkout')) creates++ })
  try {
    // This role never receives the original browser's storage or private URL.
    // Only the public event/cart path is retained; there is no authority to
    // reconstruct the original confirmation bearer from organizer SQL access.
    const originalPublicCheckout = value.results.providerUnknownCheckoutUrl
    if (typeof originalPublicCheckout !== 'string') throw new Error('Public checkout route missing')
    const before = ticketFacts(original)
    await privateGoto(lost.page, originalPublicCheckout)
    await expect(lost.page.getByLabel('Your name', { exact: true })).toBeVisible()
    const retained = await lost.page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('whereto.checkout-attempt.v1:')))
    expect(retained).toBe(false)
    expect(await lost.page.getByRole('button', { name: 'Check status', exact: true }).count()).toBe(0)
    expect(creates).toBe(0)
    expect(ticketFacts(original)).toEqual(before)
    const recipient = emailFor(value, 'checkout-provider-unknown')
    expect(dbJson<{ count: number }>(`select jsonb_build_object('count',count(*)) from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(recipient)};`).count).toBe(1)
    value.results.J08e = { originalOrderId: original, outcome: 'original attempt unrecoverable from this browser after complete proof loss', noReplacementAttempt: true, applicationRecoveryNotClaimed: true }
  } finally { await lost.close() }
}))

test('J06c postponed saved event publishes a fresh revision and recovery link without issuing tickets', async ({ browser }) => journey('J06c', async value => {
  const eventId = requireId(value.events?.recoveryFree?.id, 'J04b recovery event')
  const source = value.results.recoveryExtraSource as { registrationId: string }
  const registrationId = requireId(source?.registrationId, 'J04b recovery registration')
  const owner = await realContext(browser, 'organizer')
  const buyer = await realContext(browser, 'postponement-recovery')
  const retainedRecovery = value.results.J06cRecoveryRetained as { requestId: string; outboxId?: string } | undefined
  let resumedRecoveryCreates = 0
  if (retainedRecovery) await buyer.context.route('**/functions/v1/ticket-recovery-request', async route => { resumedRecoveryCreates++; await route.abort() })
  try {
    await organizerLogin(owner.page, value)
    const before = ticketFacts(registrationId, true)
    const retainedPublication = value.results.J06cRetainedPublication as { eventId: string; revision: number; startsAt: string; endsAt: string } | undefined
    if (!value.results.J06cPublished && retainedPublication) {
      expect(retainedPublication.eventId).toBe(eventId)
      await settleRepublishedRevision(value, eventId, retainedPublication.revision)
      value.results.J06cPublished = true; saveScenario(value)
    }
    if (!value.results.J06cPublished) {
      await owner.page.goto(origin + `/organizer/events/${eventId}/edit`)
      await owner.page.getByRole('button', { name: 'Continue to date & location', exact: true }).click()
      const future = new Date(Date.now() + 6 * 86400000)
      const minute = (instant: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant).replace(' ', 'T')
      await owner.page.getByLabel('Starts', { exact: true }).fill(minute(future))
      await owner.page.getByLabel('Ends', { exact: true }).fill(minute(new Date(future.getTime() + 3 * 3600000)))
      await owner.page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(owner.page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
      await owner.page.getByRole('button', { name: 'Continue to tickets & admission', exact: true }).click()
      await owner.page.getByRole('button', { name: 'Continue to event requirements', exact: true }).click()
      await owner.page.getByRole('button', { name: 'Continue to organizer agreement', exact: true }).click()
      await owner.page.getByRole('checkbox', { name: /I confirm that this event information/ }).check()
      await owner.page.getByRole('button', { name: 'Save agreement and preview', exact: true }).click()
      await confirmRepublishedRevision(owner.page, value, eventId)
      value.results.J06cPublished = true; saveScenario(value)
    }
    if (retainedRecovery) {
      const savedRequestId = requireId(await buyer.page.evaluate(() => JSON.parse(sessionStorage.getItem('wheretoo:ticket-recovery:v1') ?? '{}').requestId as string | undefined), 'Original J06c recovery request')
      expect(savedRequestId).toBe(retainedRecovery.requestId)
      const rows = outboxRows(`purpose='recovery' and request_id=${quote(savedRequestId)}`)
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(requireId(retainedRecovery.outboxId, 'Original J06c recovery outbox'))
    } else {
      await buyer.page.goto(origin + '/tickets/recover')
      await buyer.page.getByLabel('Email address', { exact: true }).fill(emailFor(value, 'free'))
      await buyer.page.getByRole('button', { name: 'Send me my tickets', exact: true }).click()
      await expect(buyer.page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible()
      const requestId = requireId(await buyer.page.evaluate(() => JSON.parse(sessionStorage.getItem('wheretoo:ticket-recovery:v1') ?? '{}').requestId as string | undefined), 'Original J06c recovery request')
      value.results.J06cRecoveryRetained = { requestId }; saveScenario(value)
      const rows = outboxRows(`purpose='recovery' and request_id=${quote(requestId)}`)
      expect(rows).toHaveLength(1)
      value.results.J06cRecoveryRetained = { requestId, outboxId: rows[0].id }; saveScenario(value)
      const workerResult = await control({ action: 'run-worker', name: 'ticket-email-worker' })
      value.results.J06cRecoveryWorkerResult = workerResult; saveScenario(value)
    }
    const delivery = await acceptedRecoveryDelivery(buyer.page)
    if (retainedRecovery) {
      expect(delivery.requestId).toBe(retainedRecovery.requestId)
      expect(delivery.outboxId).toBe(retainedRecovery.outboxId)
      expect(resumedRecoveryCreates).toBe(0)
    }
    const fresh = delivery.url
    value.results.J06cRecoveryDelivery = delivery
    expect(fresh === value.results.multiSourceRecoveryUrl).toBe(false)
    value.results.postponementFreshRecoveryUrl = fresh; saveScenario(value)
    await privateGoto(buyer.page, fresh)
    await expect(buyer.page.locator('.delivery-index-list a')).toHaveCount(2)
    const eventTitle = value.events!.recoveryFree.title
    await buyer.page.locator('.delivery-index-list a').filter({ hasText: eventTitle }).click()
    await expect(buyer.page.locator('.buyer-wallet-row')).toHaveCount(3)
    expect(ticketFacts(registrationId, true)).toEqual(before)
    expect(resumedRecoveryCreates).toBe(0)
    value.results.J06c = { eventId, registrationId, freshAccessSameTickets: true, noReissuance: true, recoveryReadbackOnly: Boolean(retainedRecovery), resumedRecoveryCreates, exactRetainedRecoveryBound: Boolean(retainedRecovery), oldGrantExpiryCoveredSeparatelyByJ04c: true }
  } finally { await owner.close(); await buyer.close() }
}))

async function confirmRepublishedRevision(page: Page, value: Scenario, eventId: string) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/rpc/publish_event_if_current') && response.request().postDataJSON()?.p_event_id === eventId),
    page.getByRole('button', { name: 'Publish changes', exact: true }).click(),
  ])
  expect(response.ok()).toBe(true)
  const envelope = z.object({ result: z.unknown(), context: z.object({ event_id: z.string().uuid(), event: z.object({ id: z.string().uuid(), organizer_id: z.string().uuid(), status: z.literal('published'), content_revision: z.number().int().nonnegative() }) }) }).parse(await response.json())
  const context = envelope.context
  expect(context.event_id).toBe(eventId)
  expect(context.event.organizer_id).toBe(requireId(value.organizerId, 'Original organizer'))
  const published = context.event
  expect(published.id).toBe(eventId); expect(published.status).toBe('published')
  await settleRepublishedRevision(value, eventId, published.content_revision)
}

async function settleRepublishedRevision(value: Scenario, eventId: string, expectedRevision: number) {
  const snapshot = () => dbJson<{ revision: number; moderation: string; moderatedRevision: number | null; evaluation: { status: string; outcome: string | null } | null }>(`select jsonb_build_object('revision',e.content_revision,'moderation',e.moderation_status,'moderatedRevision',e.moderated_revision,'evaluation',(select jsonb_build_object('status',q.status,'outcome',q.outcome) from private.event_moderation_evaluations q where q.event_id=e.id and q.content_revision=e.content_revision order by q.created_at desc limit 1)) from public.events e where e.id=${quote(eventId)};`)
  const steps: unknown[] = []
  const key = `republishModeration-${eventId}-${expectedRevision}`
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = snapshot()
    expect(before.revision).toBe(expectedRevision)
    if (before.evaluation?.status !== 'queued') break
    const result = await control({ action: 'run-worker', name: 'moderate-event-queue' })
    steps.push({ before, result, after: snapshot() })
    value.results[key] = { eventId, revision: expectedRevision, steps }; saveScenario(value)
  }
  const final = snapshot()
  value.results[key] = { eventId, revision: expectedRevision, steps, final }; saveScenario(value)
  expect(final.revision).toBe(expectedRevision)
  expect(final.moderation).toBe('clear')
  expect(final.moderatedRevision).toBe(expectedRevision)
}

async function publishVenue(page: Page, value: Scenario, eventId: string, venue: string) {
  await page.goto(origin + `/organizer/events/${eventId}/edit`)
  await page.getByRole('button', { name: 'Continue to date & location', exact: true }).click()
  await page.getByLabel('Venue name', { exact: true }).fill(venue)
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Continue to tickets & admission', exact: true }).click()
  await page.getByRole('button', { name: 'Continue to event requirements', exact: true }).click()
  await page.getByRole('button', { name: 'Continue to organizer agreement', exact: true }).click()
  await page.getByRole('checkbox', { name: /I confirm that this event information/ }).check()
  await page.getByRole('button', { name: 'Save agreement and preview', exact: true }).click()
  await confirmRepublishedRevision(page, value, eventId)
}

test('J06d stale notice review is rejected and only unsent superseded revisions are suppressed', async ({ browser }) => journey('J06d', async value => {
  const eventId = requireId(value.events?.recoveryFree?.id, 'J04b explicit recovery event')
  const owner = await realContext(browser, 'organizer')
  const concurrent = await owner.context.newPage()
  try {
    await organizerLogin(owner.page, value)
    if (!value.results.J06dOldQueued) {
      await owner.page.goto(origin + `/organizer/events/${eventId}/changes`)
      await owner.page.getByRole('button', { name: 'Review notice recipients', exact: true }).click()
      await expect(owner.page.getByRole('heading', { name: 'Reviewed audience', exact: true })).toBeVisible()
      await publishVenue(concurrent, value, eventId, 'Notice revision two ' + value.runId)
      await owner.page.getByRole('button', { name: 'Submit reviewed notice', exact: true }).click()
      await expect(owner.page.getByText('The event or audience changed. Refresh and review the new audience before sending.', { exact: true })).toBeVisible()
      await owner.page.reload()
      await owner.page.getByRole('button', { name: 'Review notice recipients', exact: true }).click()
      await owner.page.getByRole('button', { name: 'Submit reviewed notice', exact: true }).click()
      await expect(owner.page.getByText('1 message queued. This does not confirm sending or delivery.', { exact: true })).toBeVisible()
      const old = dbJson<{ noticeId: string; outboxId: string }>(`select jsonb_build_object('noticeId',n.id,'outboxId',s.attempt_id) from private.event_notices n join private.event_notice_sources s on s.notice_id=n.id where n.event_id=${quote(eventId)} and n.purpose='event_change' order by n.created_at desc limit 1;`)
      value.results.J06dOldQueued = old; saveScenario(value)
    }
    const old = value.results.J06dOldQueued as { noticeId: string; outboxId: string }
    if (!value.results.J06dNewQueued) {
      await publishVenue(concurrent, value, eventId, 'Notice revision three ' + value.runId)
      await owner.page.goto(origin + `/organizer/events/${eventId}/changes`)
      await owner.page.getByRole('button', { name: 'Review notice recipients', exact: true }).click()
      await owner.page.getByRole('button', { name: 'Submit reviewed notice', exact: true }).click()
      await expect(owner.page.getByText('1 message queued. This does not confirm sending or delivery.', { exact: true })).toBeVisible()
      value.results.J06dNewQueued = dbJson<{ noticeId: string; outboxId: string }>(`select jsonb_build_object('noticeId',n.id,'outboxId',s.attempt_id) from private.event_notices n join private.event_notice_sources s on s.notice_id=n.id where n.event_id=${quote(eventId)} and n.purpose='event_change' order by n.created_at desc limit 1;`); saveScenario(value)
    }
    const current = value.results.J06dNewQueued as { noticeId: string; outboxId: string }
    await control({ action: 'email-mode', mode: 'accepted' })
    await control({ action: 'run-worker', name: 'ticket-email-worker' })
    const state = (id: string) => dbJson<{ state: string }>(`select jsonb_build_object('state',state) from private.ticket_email_outbox where id=${quote(id)};`).state
    expect(state(old.outboxId)).toBe('suppressed'); expect(state(current.outboxId)).toBe('accepted')
    if (!value.results.J06dFinalRevision) {
      await publishVenue(concurrent, value, eventId, 'Notice revision four ' + value.runId)
      value.results.J06dFinalRevision = true; saveScenario(value)
    }
    await control({ action: 'run-worker', name: 'ticket-email-worker' })
    expect(state(current.outboxId)).toBe('accepted')
    value.results.J06d = { eventId, staleReviewRejected: true, unsentNoticeSuppressed: old.noticeId, acceptedNoticePreserved: current.noticeId }
  } finally { await concurrent.close(); await owner.close() }
}))


test('J03a separate free reader-boundary draft reaches preview without paid APIs and stays undiscoverable', async ({ browser }) => journey('J03a', async value => {
  const owner = await realContext(browser, 'organizer')
  const visitor = await realContext(browser, 'free-reader-boundary-public')
  const forbidden: string[] = []
  const paidCardReads: string[] = []
  const paidNames = new Set(['list_owned_ticket_tiers', 'save_ticket_tiers', 'activate_paid_sales', 'get_organizer_event_metrics', 'get_organizer_order', 'get_organizer_order_v2', 'list_organizer_event_orders_filtered', 'list_organizer_event_admissions', 'organizer-refund-order', 'ticket_tiers'])
  for (const context of [owner.context, visitor.context]) context.on('request', request => {
    if (isOriginalPaidCardRead(request, value)) { paidCardReads.push('original-paid-event-card'); return }
    const path = new URL(request.url()).pathname
    const name = path.split('/').at(-1) ?? ''
    if (name.startsWith('stripe-') || paidNames.has(name)) forbidden.push(path)
  })
  try {
    await organizerLogin(owner.page, value)
    const eventId = await eventThroughUi(owner.page, value, 'free-reader-boundary-draft', 'free', { stopAtPreview: true })
    await expect(owner.page.getByRole('heading', { name: 'Preview your event', exact: true })).toBeVisible()
    const facts = dbJson<{ status: string; admission: string; tiers: number; registrations: number }>(`select jsonb_build_object('status',e.status,'admission',e.admission_type,'tiers',(select count(*) from public.ticket_tiers t where t.event_id=e.id),'registrations',(select count(*) from public.free_registrations r where r.event_id=e.id)) from public.events e where e.id=${quote(eventId)};`)
    expect(facts).toEqual({ status: 'draft', admission: 'free', tiers: 0, registrations: 0 })
    await visitor.page.goto(origin + '/discover?category=community&price=free')
    await expect(visitor.page.getByLabel('Discovery results', { exact: true })).toBeVisible()
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      await expect(visitor.page.locator(`a[href="/events/${eventId}"]`)).toHaveCount(0)
      const more = visitor.page.getByRole('button', { name: 'Load more', exact: true })
      if (!await more.isVisible()) break
      await Promise.all([visitor.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/functions/v1/public-discovery') && response.request().method() === 'POST'), more.click()])
      await expect(visitor.page.getByRole('button', { name: 'Loading more events…', exact: true })).toHaveCount(0)
      if (pageNumber === 9) throw new Error('Draft-exclusion discovery pagination exceeded the bounded proof')
    }
    await visitor.page.goto(origin + `/events/${eventId}`)
    await expect(visitor.page.getByRole('heading', { name: 'Event not found', exact: true })).toBeVisible()
    expect(forbidden).toEqual([])
    value.results.J03a = { eventId, outcome: 'passed-separate-negative-draft', forbidden, paidCardReads, monitoredPaidApis: [...paidNames, 'stripe-*'], facts, published: false }
  } finally { await owner.close(); await visitor.close() }
}))

test('J08f real free admission result survives failed metrics refresh without another scan', async ({ browser }) => journey('J08f', async value => {
  const eventId=requireId(value.freeEventId,'Original free event')
  const buyer=await realContext(browser,'metrics-failure-free-buyer'),owner=await realContext(browser,'organizer')
  try {
    const source=await separateFreeSource(buyer.page,value,eventId,'metricsFailureFreeSource',emailFor(value,'metrics-failure-free'))
    if(value.results.J08f) return
    const before=ticketFacts(source.registrationId,true)
    if(before.some(ticket=>ticket.status!=='valid')) throw new Error('Fresh Admitted retention proof was interrupted; preserve the existing registration rather than replace it')
    const qr=await ticketQr(buyer.page,source.collectionUrl,1)
    await organizerLogin(owner.page,value)
    let admissionResponses=0,failedRefreshes=0
    let sawAdmission=false
    owner.page.on('response',response=>{
      if(new URL(response.url()).pathname.endsWith('/functions/v1/ticket-admission')) {admissionResponses++;sawAdmission=true}
    })
    await owner.page.route('**/rest/v1/rpc/get_organizer_free_registration_metrics',async route=>{
      if(sawAdmission && failedRefreshes===0) {failedRefreshes++;await route.abort('failed')}
      else await route.fallback()
    })
    await qrCamera(owner.page,qr)
    await owner.page.goto(origin+`/organizer/events/${eventId}/check-in/scan`)
    await expect(owner.page.getByRole('heading',{name:'Admitted',exact:true})).toBeVisible()
    await expect(owner.page.getByText(/Check-in totals could not refresh/)).toBeVisible()
    expect(failedRefreshes).toBe(1);expect(admissionResponses).toBe(1)
    const committed=ticketFacts(source.registrationId,true)
    expect(committed[1].status).toBe('used');expect(committed[0]).toEqual(before[0]);expect(committed[2]).toEqual(before[2])
    await owner.page.getByRole('button',{name:'Refresh totals',exact:true}).click()
    await expect(owner.page.getByText(/Check-in totals could not refresh/)).toHaveCount(0)
    await expect(owner.page.getByRole('heading',{name:'Admitted',exact:true})).toBeVisible()
    expect(admissionResponses).toBe(1);expect(ticketFacts(source.registrationId,true)).toEqual(committed)
    value.results.J08f={registrationId:source.registrationId,selectedTicketId:committed[1].id,usedAt:committed[1].usedAt,failedRefreshes,admissionResponses,outcome:'passed-real-admitted-retention'}
  } finally {await buyer.close();await owner.close()}
}))

test('J08g unattached original checkout crosses real minimum lifetime before its signed payment', async ({ browser }) => journey('J08g', async value => {
  const eventId = requireId(value.paidEventId, 'Principal paid event')
  const recipient = emailFor(value, 'checkout-minimum-lifetime')
  const buyer = await realContext(browser, 'checkout-minimum-lifetime')
  type Retained = { orderId: string; sessionId: string; expiresAt: string; requestId: string; bearer: string; items: RefundItem[] }
  try {
    if (value.results.J08g) return
    let retained = value.results.minimumLifetimeSource as Retained | undefined
    if (!retained) {
      const priorUrl = value.results.minimumLifetimeCheckoutUrl
      if (typeof priorUrl === 'string') await privateGoto(buyer.page, priorUrl)
      else {
        await discover(buyer.page, eventId)
        await buyer.page.getByLabel('General Admission quantity', { exact: true }).fill('2')
        await buyer.page.getByLabel('VIP quantity', { exact: true }).fill('1')
        await continueToCheckout(buyer.page)
        await expect(buyer.page.getByLabel('Your name', { exact: true })).toBeVisible()
        value.results.minimumLifetimeCheckoutUrl = buyer.page.url(); saveScenario(value)
      }
      let sessionId = value.results.minimumLifetimeSessionId
      if (typeof sessionId !== 'string') {
        const stateBefore = await control<{stripe:{checkoutSessionIds:string[]}}>({action:'state'})
        value.results.minimumLifetimeProviderBefore = stateBefore.stripe.checkoutSessionIds; saveScenario(value)
        await control({action:'checkout-mode',mode:'commit_then_unknown'})
        await buyer.page.getByLabel('Your name', { exact: true }).fill('Minimum Lifetime Guest')
        await buyer.page.getByLabel('Email address', { exact: true }).fill(recipient)
        await buyer.page.getByRole('button', { name: 'Continue to secure payment', exact: true }).click()
        await expect(buyer.page.getByRole('heading', { name: 'Unable to confirm payment', exact: true })).toBeVisible()
        const stateAfter = await control<{stripe:{checkoutSessionIds:string[]}}>({action:'state'})
        const created = stateAfter.stripe.checkoutSessionIds.filter(id => !stateBefore.stripe.checkoutSessionIds.includes(id))
        expect(created).toHaveLength(1)
        sessionId = created[0]; value.results.minimumLifetimeSessionId = sessionId; saveScenario(value)
      }
      const orders = dbJson<{id:string;expiresAt:string;sessionId:string|null}[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'expiresAt',checkout_expires_at,'sessionId',stripe_checkout_session_id)),'[]'::jsonb) from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(recipient)};`)
      expect(orders).toHaveLength(1); expect(orders[0].sessionId).toBeNull()
      const original = await buyer.page.evaluate(id => JSON.parse(sessionStorage.getItem('whereto.checkout-attempt.v1:'+id) ?? '{}') as {clientRequestId?:string;confirmationBearer?:string}, eventId)
      if (!original.confirmationBearer || !/^[A-Za-z0-9_-]{43}$/.test(original.confirmationBearer)) throw new Error('Original confirmation proof is absent; no replacement checkout is permitted')
      retained = {orderId:orders[0].id,sessionId:sessionId as string,expiresAt:orders[0].expiresAt,requestId:requireId(original.clientRequestId,'Original checkout request'),bearer:original.confirmationBearer,items:financialSnapshot(orders[0].id).items}
      value.results.minimumLifetimeSource = retained; saveScenario(value)
    }
    await control({action:'checkout-mode',mode:'normal'})
    if (!value.results.J08gMinimumObserved) {
      // Production requires 30m plus three 80-second attempts; do not alter clocks.
      const threshold = Date.parse(retained.expiresAt) - 34*60_000 + 1_000
      expect(Number.isFinite(threshold)).toBe(true)
      expect(threshold-Date.now()).toBeLessThanOrEqual(305_000)
      while (Date.now() < threshold) await new Promise(resolve => setTimeout(resolve, Math.min(10_000, threshold-Date.now())))
      await privateGoto(buyer.page,value.results.minimumLifetimeCheckoutUrl as string)
      const check = buyer.page.getByRole('button',{name:'Check status',exact:true})
      await expect.poll(async () => await check.isVisible() || await buyer.page.getByRole('button',{name:/^(Re-enter original details|Retry same checkout)$/}).isVisible()).toBe(true)
      if(await check.isVisible()) await check.click()
      const retry = buyer.page.getByRole('button',{name:/^(Re-enter original details|Retry same checkout)$/})
      await expect(retry).toBeEnabled(); await retry.click()
      await expect(buyer.page.getByLabel('Your name',{exact:true})).toBeVisible()
      await buyer.page.getByLabel('Your name',{exact:true}).fill('Minimum Lifetime Guest')
      await buyer.page.getByLabel('Email address',{exact:true}).fill(recipient)
      const providerBefore = await control<{stripe:{checkoutSessionIds:string[]}}>({action:'state'})
      const responsePending = buyer.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/functions/v1/stripe-create-checkout'))
      await buyer.page.getByRole('button',{name:'Retry same checkout',exact:true}).click()
      const response = await responsePending
      const body = await response.json() as {error?:{code?:string};code?:string}
      await expect(buyer.page.getByRole('heading',{name:'Unable to confirm payment',exact:true})).toBeVisible()
      const current = await buyer.page.evaluate(id => JSON.parse(sessionStorage.getItem('whereto.checkout-attempt.v1:'+id) ?? '{}') as {clientRequestId?:string;confirmationBearer?:string}, eventId)
      expect(current.clientRequestId).toBe(retained.requestId);expect(current.confirmationBearer === retained.bearer).toBe(true)
      const after = financialSnapshot(retained.orderId)
      const providerAfter = await control<{stripe:{checkoutSessionIds:string[]}}>({action:'state'})
      value.results.J08gMinimumObserved={status:response.status(),body,observedAt:new Date().toISOString(),threshold:new Date(threshold).toISOString(),order:after.order,items:after.items,tickets:after.tickets,providerSessionIds:providerAfter.stripe.checkoutSessionIds};saveScenario(value)
      expect(response.status()).toBe(410)
      expect(body).toMatchObject({error:{code:'CHECKOUT_EXPIRED'}})
      expect(after.order.stripe_checkout_session_id).toBeNull();expect(after.items).toEqual(retained.items);expect(after.tickets).toHaveLength(0)
      expect(providerAfter.stripe.checkoutSessionIds).toEqual(providerBefore.stripe.checkoutSessionIds)
      expect(dbJson<{count:number}>(`select jsonb_build_object('count',count(*)) from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(recipient)};`).count).toBe(1)
    }
    let completion = value.results.J08gCompletion as {successUrl?:string;error?:string} | undefined
    if (!completion) {
      expect(Date.now()).toBeLessThan(Date.parse(retained.expiresAt))
      try {completion=await control<{successUrl?:string}>({action:'checkout-complete',sessionId:retained.sessionId})}
      catch(error) {completion={error:error instanceof Error ? error.message : 'Provider completion control failed'}}
      value.results.J08gCompletion=completion;saveScenario(value)
    }
    await privateGoto(buyer.page,completion.successUrl ?? origin+'/orders/'+retained.bearer)
    const heading=buyer.page.getByRole('heading',{name:/^(Confirming your payment|You're all set|Order needs review|Unable to confirm payment)$/})
    await expect(heading).toBeVisible()
    const final=financialSnapshot(retained.orderId)
    const receipts=dbJson<Database['public']['Tables']['stripe_webhook_events']['Row'][]>(`select coalesce(jsonb_agg(to_jsonb(w) order by first_received_at),'[]'::jsonb) from public.stripe_webhook_events w where stripe_object_id=${quote(retained.sessionId)};`)
    value.results.J08gObservation={order:final.order,items:final.items,tickets:final.tickets,receipts,heading:await heading.textContent(),sameOriginalOrder:true,sameProviderSession:true};saveScenario(value)
    // This assertion intentionally remains red if the authentic paid event cannot reconcile.
    expect(final.order.status).toBe('paid')
    expect(final.order.stripe_checkout_session_id).toBe(retained.sessionId)
    expect(final.items).toEqual(retained.items);expect(final.tickets).toHaveLength(3)
    value.results.J08g={orderId:retained.orderId,sessionId:retained.sessionId,realElapsedMinimumBoundary:true,originalSignedPaymentReconciled:true}
  } finally {await control({action:'checkout-mode',mode:'normal'});await buyer.close()}
}))
