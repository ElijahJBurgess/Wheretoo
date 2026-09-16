import { createHash } from 'node:crypto'
import { chmodSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { control, dbJson, origin, privateGoto, quote, realContext, requireId, scenario, statePath } from './support/spec14Harness'

// Separately named forward control. The historical J08g source and failed receipt are immutable.
const output = resolve(statePath, 'j08g-unattached-forward-control.json')
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function historical() {
  return dbJson(`select jsonb_build_object('order',(select to_jsonb(o) from public.orders o where id='8948b48b-8926-4df4-8034-117b9039febd'),
    'items',(select jsonb_agg(to_jsonb(i) order by id) from public.order_items i where order_id='8948b48b-8926-4df4-8034-117b9039febd'),
    'tickets',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.tickets t where order_id='8948b48b-8926-4df4-8034-117b9039febd'),
    'receipt',(select to_jsonb(r) from public.stripe_webhook_events r where stripe_event_id='evt_spec1400000003'));`)
}
function facts(id: string) {
  return dbJson<{ order: { id: string; status: string; client_request_id: string; stripe_checkout_session_id: string | null; checkout_expires_at: string }; items: unknown[]; tickets: { id: string; unit_sequence: number; status: string }[]; receipts: unknown[]; initialEmails: number; initialOutbox: { id: string; order_id: string; purpose: string; state: string; dispatch_count: number; grant_id: string | null; provider_id: string | null }[] }>(`select jsonb_build_object('order',to_jsonb(o),
    'items',(select jsonb_agg(to_jsonb(i) order by id) from public.order_items i where order_id=o.id),
    'tickets',(select coalesce(jsonb_agg(to_jsonb(t) order by order_item_id,unit_sequence),'[]') from public.tickets t where order_id=o.id),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by stripe_event_id),'[]') from public.stripe_webhook_events r where stripe_object_id=o.stripe_checkout_session_id),
    'initialEmails',(select count(*) from private.ticket_email_outbox e where order_id=o.id and purpose='initial'),
    'initialOutbox',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from private.ticket_email_outbox e where order_id=o.id and purpose='initial')) from public.orders o where o.id=${quote(id)};`)
}

test('J08g forward negative control: same unattached Session fulfills original units exactly once', async ({ browser }) => {
  if (existsSync(output)) throw new Error('Forward control already has retained evidence; review it before any continuation. No replacement attempt is permitted.')
  if (!existsSync(resolve(statePath, 'scenario.json'))) throw new Error('Existing scenario is required; this control cannot create a principal scenario')
  const value = scenario()
  const eventId = requireId(value.paidEventId, 'Existing paid event')
  const recipient = `unattached-forward-${value.runId}@spec14.test`
  const evidence: Record<string, unknown> = { name: 'unattached-checkout-forward-recovery', status: 'running', startedAt: new Date().toISOString(), historicalBeforeHash: digest(historical()) }
  const save = () => { writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 }); chmodSync(output, 0o600) }
  save()
  const buyer = await realContext(browser, 'unattached-forward-control')
  let modeOwned = false
  const errors: string[] = []
  buyer.page.on('pageerror', error => errors.push(error.name))
  const finalize = async () => {
    try {
      if (modeOwned) await control({ action: 'checkout-mode', mode: 'normal' })
      evidence.pageErrors = errors; evidence.historicalFinalHash = digest(historical()); save()
      expect(evidence.historicalFinalHash).toBe(evidence.historicalBeforeHash)
      await buyer.close()
      if (evidence.status !== 'failed' && evidence.checksPassed === true) {
        evidence.status = 'passed'; evidence.completedAt = new Date().toISOString(); save()
      }
    } catch (error) {
      evidence.status = 'failed'; evidence.finalizationFailureType = error instanceof Error ? error.name : 'Unknown'; save(); throw error
    }
  }
  try {
    await buyer.page.goto(origin + '/discover')
    const link = buyer.page.locator(`a[href="/events/${eventId}"]`).first()
    await expect(link).toBeVisible(); await link.click()
    await buyer.page.getByLabel('General Admission quantity', { exact: true }).fill('2')
    await buyer.page.getByLabel('VIP quantity', { exact: true }).fill('1')
    const cart = await buyer.page.locator('.public-ticket-tier__quantity input').evaluateAll(inputs => inputs
      .map(i => i as HTMLInputElement).filter(i => i.valueAsNumber > 0).map(i => `${i.id.replace('ticket-quantity-', '')}:${i.valueAsNumber}`).sort())
    await expect.poll(() => new URL(buyer.page.url()).searchParams.getAll('item').sort()).toEqual(cart)
    await buyer.page.getByRole('button', { name: 'Continue to checkout', exact: true }).click()
    await expect(buyer.page.getByLabel('Your name', { exact: true })).toBeVisible()
    const checkoutUrl = buyer.page.url()
    const before = await control<{ stripe: { checkoutSessionIds: string[] } }>({ action: 'state' })
    evidence.providerBefore = before; save()
    expect(dbJson<{ count: number }>(`select jsonb_build_object('count',count(*)) from public.orders where buyer_email=${quote(recipient)};`).count).toBe(0)
    await control({ action: 'checkout-mode', mode: 'commit_then_unknown' }); modeOwned = true
    await buyer.page.getByLabel('Your name', { exact: true }).fill('Unattached Forward Control')
    await buyer.page.getByLabel('Email address', { exact: true }).fill(recipient)
    await buyer.page.getByRole('button', { name: 'Continue to secure payment', exact: true }).click()
    await expect(buyer.page.getByRole('heading', { name: 'Unable to confirm payment', exact: true })).toBeVisible()
    const after = await control<{ stripe: { checkoutSessionIds: string[] } }>({ action: 'state' })
    const sessions = after.stripe.checkoutSessionIds.filter(id => !before.stripe.checkoutSessionIds.includes(id))
    expect(sessions).toHaveLength(1)
    const orders = dbJson<{ id: string }[]>(`select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') from public.orders where event_id=${quote(eventId)} and buyer_email=${quote(recipient)};`)
    expect(orders).toHaveLength(1)
    const initial = facts(orders[0].id)
    const attempt = await buyer.page.evaluate(id => JSON.parse(sessionStorage.getItem('whereto.checkout-attempt.v1:' + id) ?? '{}') as { clientRequestId?: string; confirmationBearer?: string }, eventId)
    if (!attempt.confirmationBearer || !attempt.clientRequestId) throw new Error('Original attempt identity is absent')
    expect(initial.order.client_request_id).toBe(attempt.clientRequestId)
    expect(initial.order.stripe_checkout_session_id).toBeNull(); expect(initial.tickets).toHaveLength(0)
    evidence.original = { orderId: orders[0].id, sessionId: sessions[0], attempt, initial }; save()
    await control({ action: 'checkout-mode', mode: 'normal' }); modeOwned = false
    // Reproduce the real minimum-create boundary on this separate forward control.
    // Time and immutable expiry are never edited; retry must retain the original request.
    const threshold = Date.parse(initial.order.checkout_expires_at) - 34 * 60_000 + 1_000
    expect(Number.isFinite(threshold)).toBe(true)
    expect(threshold - Date.now()).toBeLessThanOrEqual(305_000)
    while (Date.now() < threshold) await new Promise(resolve => setTimeout(resolve, Math.min(10_000, threshold - Date.now())))
    await privateGoto(buyer.page, checkoutUrl)
    const check = buyer.page.getByRole('button', { name: 'Check status', exact: true })
    const retry = buyer.page.getByRole('button', { name: /^(Re-enter original details|Retry same checkout)$/ })
    await expect.poll(async () => await check.isVisible() || await retry.isVisible()).toBe(true)
    if (await check.isVisible()) await check.click()
    await expect(retry).toBeEnabled(); await retry.click()
    await expect(buyer.page.getByLabel('Your name', { exact: true })).toBeVisible()
    await buyer.page.getByLabel('Your name', { exact: true }).fill('Unattached Forward Control')
    await buyer.page.getByLabel('Email address', { exact: true }).fill(recipient)
    const retryResponse = buyer.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/functions/v1/stripe-create-checkout'))
    await buyer.page.getByRole('button', { name: 'Retry same checkout', exact: true }).click()
    const response = await retryResponse
    expect(response.status()).toBe(410)
    expect(await response.json()).toMatchObject({ error: { code: 'CHECKOUT_EXPIRED' } })
    await expect(buyer.page.getByRole('heading', { name: 'Unable to confirm payment', exact: true })).toBeVisible()
    const retained = await buyer.page.evaluate(id => JSON.parse(sessionStorage.getItem('whereto.checkout-attempt.v1:' + id) ?? '{}') as { clientRequestId?: string; confirmationBearer?: string }, eventId)
    expect(retained.clientRequestId).toBe(attempt.clientRequestId)
    expect(retained.confirmationBearer === attempt.confirmationBearer).toBe(true)
    const afterMinimum = facts(orders[0].id)
    expect(afterMinimum.order.stripe_checkout_session_id).toBeNull(); expect(afterMinimum.tickets).toHaveLength(0)
    expect(afterMinimum.items).toEqual(initial.items)
    expect((await control<{ stripe: { checkoutSessionIds: string[] } }>({ action: 'state' })).stripe.checkoutSessionIds).toEqual(after.stripe.checkoutSessionIds)
    evidence.minimumBoundary = { threshold: new Date(threshold).toISOString(), observedAt: new Date().toISOString(), status: response.status(), sameRequest: true, afterMinimum }; save()
    expect(Date.now()).toBeLessThan(Date.parse(initial.order.checkout_expires_at))
    evidence.completionIntent = true; save()
    const completion = await control<{ successUrl: string }>({ action: 'checkout-complete', sessionId: sessions[0] })
    evidence.completionResponse = completion; save()
    await privateGoto(buyer.page, completion.successUrl)
    await expect(buyer.page.getByRole('heading', { name: "You're all set", exact: true })).toBeVisible()
    const paid = facts(orders[0].id); evidence.afterPaid = paid; save()
    expect(paid.order.status).toBe('paid'); expect(paid.order.stripe_checkout_session_id).toBe(sessions[0])
    expect(paid.items).toEqual(initial.items); expect(paid.tickets).toHaveLength(3)
    expect(paid.tickets.every(t => t.status === 'valid')).toBe(true); expect(paid.initialEmails).toBe(1)
    expect(paid.initialOutbox).toHaveLength(1)
    expect(paid.initialOutbox[0]).toMatchObject({ order_id: orders[0].id, purpose: 'initial', state: 'queued', dispatch_count: 0, grant_id: null, provider_id: null })
    evidence.initialEmailTarget = { orderId: orders[0].id, sessionId: sessions[0], outboxId: paid.initialOutbox[0].id, originalOutbox: paid.initialOutbox[0], ticketIds: paid.tickets.map(t => t.id), workerClosure: 'pending-separate-bounded-proof' }; save()
    // A separately signed observation of this SAME new Session tests domain idempotency.
    evidence.replayIntent = true; save()
    evidence.replayResponse = await control({ action: 'stripe-event', type: 'checkout.session.async_payment_succeeded', objectId: sessions[0] }); save()
    const repeated = facts(orders[0].id); evidence.afterReplay = repeated; save()
    expect(repeated.tickets).toEqual(paid.tickets); expect(repeated.items).toEqual(paid.items); expect(repeated.initialEmails).toBe(1)
    expect(repeated.initialOutbox).toEqual(paid.initialOutbox)
    expect(repeated.order.stripe_checkout_session_id).toBe(sessions[0])
    const finalProvider = await control<{ stripe: { checkoutSessionIds: string[] } }>({ action: 'state' })
    expect(finalProvider.stripe.checkoutSessionIds).toEqual(after.stripe.checkoutSessionIds)
    expect(digest(historical())).toBe(evidence.historicalBeforeHash)
    expect(errors).toEqual([])
    evidence.checksPassed = true; evidence.historicalAfterHash = digest(historical()); save()
  } catch (error) {
    evidence.status = 'failed'; evidence.failureType = error instanceof Error ? error.name : 'Unknown'; save(); throw error
  } finally {
    await finalize()
  }
})
