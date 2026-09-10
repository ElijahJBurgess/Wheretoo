import { createHmac } from 'node:crypto'
import { expect, test } from '@playwright/test'
// Disposable local PostgREST/DB only. Auth is synthetic; all operational RPCs
// execute the real migrations with authenticated/ service_role privileges.
const rest = 'http://127.0.0.1:55436'
const owner = 'a6100000-0000-4000-8000-000000000001'
const other = 'a6100000-0000-4000-8000-000000000002'
const eventId = 'a6200000-0000-4000-8000-000000000001'
function jwt(sub = owner, role = 'authenticated') {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const input = `${enc({ alg: 'HS256', typ: 'JWT' })}.${
    enc({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 })
  }`
  return `${input}.${
    createHmac('sha256', 'organizer-ops-local-only-jwt-secret-2026').update(input).digest(
      'base64url',
    )
  }`
}
async function rpc(name: string, data: unknown, token = jwt()) {
  const response = await fetch(`${rest}/rpc/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    throw new Error(`Local RPC ${name}: ${response.status} ${await response.text()}`)
  }
  return response.json()
}

test(
  'owned operations journey against the disposable database, desktop and mobile',
  async ({ page }, info) => {
    await page.addInitScript(({ token, owner }) => {
      localStorage.setItem(
        'sb-ops-local-auth-token',
        JSON.stringify({
          access_token: token,
          refresh_token: 'local-fixture',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
          user: {
            id: owner,
            aud: 'authenticated',
            role: 'authenticated',
            email: 'organizer@example.invalid',
            app_metadata: {},
            user_metadata: {},
            created_at: '2026-01-01T00:00:00Z',
          },
        }),
      )
    }, { token: jwt(), owner })
    await page.route('https://ops-local.supabase.co/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname.startsWith('/rest/v1/')) {
        const response = await fetch(rest + url.pathname.replace('/rest/v1', '') + url.search, {
          method: request.method(),
          headers: request.headers(),
          body: request.postData() ?? undefined,
        })
        await route.fulfill({
          status: response.status,
          headers: { 'content-type': 'application/json' },
          body: await response.text(),
        })
        return
      }
      if (url.pathname === '/functions/v1/organizer-refund-order') {
        await route.fulfill({ json: { outcome: 'pending' } })
        return
      }
      await route.abort()
    })
    const list = await rpc('list_organizer_event_orders', { p_event_id: eventId })
    const paid = list.orders.find((row: { status: string }) => row.status === 'paid')
    expect(paid).toBeTruthy()
    for (
      const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, {
        width: 320,
        height: 800,
      }, { width: 390, height: 844 }]
    ) {
      await page.setViewportSize(viewport)
      await page.goto('/organizer/events')
      await expect(page.getByRole('link', { name: /Sunset Rooftop Sessions/ })).toBeVisible()
      await expect(page.getByRole('link', { name: /Sunset Rooftop Sessions/ })).toHaveCSS(
        'background-color',
        'rgb(12, 21, 30)',
      )
      await page.screenshot({
        path: info.outputPath(`events-${viewport.width}.png`),
        fullPage: true,
      })
      await page.getByRole('link', { name: /Sunset Rooftop Sessions/ }).click()
      await expect(page.getByRole('heading', { name: 'Sunset Rooftop Sessions' })).toBeVisible()
      await expect(page.locator('.ops-metrics dt')).toHaveCount(4)
      await expect(page.locator('.ops-metrics')).toContainText('$30.01')
      await expect(page.locator('.ops-metrics dd')).toHaveText(['$30.01', '3 / 24', '1', '0 / 3'])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({
        path: info.outputPath(`dashboard-${viewport.width}.png`),
        fullPage: true,
      })
      await page.getByRole('link', { name: 'View orders' }).click()
      await page.getByRole('searchbox').fill(paid.orderNumber)
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      await expect(page.locator('.ops-orders li')).toHaveCount(1)
      expect((await page.locator('label[for="order-search"]').boundingBox())?.width).toBe(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({
        path: info.outputPath(`orders-${viewport.width}.png`),
        fullPage: true,
      })
      await page.locator('.ops-orders li a').click()
      await expect(page.getByText('Ticket 3', { exact: true })).toBeVisible()
      await page.screenshot({
        path: info.outputPath(`detail-${viewport.width}.png`),
        fullPage: true,
      })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    }
    // Exercise empty results and every approved search field through the browser.
    await page.goto(`/organizer/events/${eventId}/orders`)
    for (
      const term of [
        'no-matching-buyer-for-this-event',
        paid.buyerName,
        paid.buyerEmail,
        paid.orderNumber,
      ]
    ) {
      await page.getByRole('searchbox').fill(term)
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      if (term.startsWith('no-matching')) {
        await expect(page.getByText('No matching orders.'))
          .toBeVisible()
      } else {await expect(
          page.locator('.ops-orders li').filter({ hasText: paid.orderNumber }),
        ).toBeVisible()}
    }
    await expect(page.locator('.ops-orders li')).toHaveCount(1)
    await page.locator('.ops-orders li a').click()
    // Native dialog keyboard cancellation restores focus and performs no admission.
    await page.getByRole('button', { name: 'Check in ticket' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Check in ticket' }).first()).toBeFocused()
    await page.getByRole('button', { name: 'Check in ticket' }).first().click()
    await expect(page.getByRole('dialog')).toContainText('Sunset Rooftop Sessions')
    await expect(page.getByRole('dialog')).toContainText('Ticket 1')
    await page.getByRole('button', { name: 'Admit guest' }).click()
    await expect(page.getByRole('dialog').getByText('Admitted', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByText(/Checked in ·/)).toBeVisible()
    const detail = await rpc('get_organizer_order', { p_event_id: eventId, p_order_id: paid.id })
    const used = detail.tickets.find((ticket: { status: string }) => ticket.status === 'used')
    expect(
      (await rpc('redeem_owned_ticket', { p_event_id: eventId, p_ticket_id: used.id })).outcome,
    ).toBe('already_used')
    // Two database sessions race QR and manual redemption for the same admission.
    const next = detail.tickets.find((ticket: { status: string }) => ticket.status === 'valid')
    const sourceResponse = await fetch(`${rest}/tickets?id=eq.${next.id}&select=credential_hash`, {
      headers: { authorization: `Bearer ${jwt(owner, 'service_role')}` },
    })
    const [source] = await sourceResponse.json()
    const race = await Promise.all([
      rpc('redeem_owned_ticket', { p_event_id: eventId, p_ticket_id: next.id }),
      rpc('server_redeem_organizer_ticket', {
        p_organizer_id: owner,
        p_event_id: eventId,
        p_credential_hash: source.credential_hash,
      }, jwt(owner, 'service_role')).then((rows) => rows[0]),
    ])
    expect(race.map((value) => value.outcome).sort()).toEqual(['admitted', 'already_used'])
    await page.getByRole('button', { name: 'Refund order', exact: true }).click()
    await page.getByRole('button', { name: 'Refund entire order', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Refund pending')
    await expect(page.getByRole('dialog')).not.toContainText('Refund confirmed')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.goto(`/organizer/events/${eventId}/check-in`)
    await expect(page.getByRole('link', { name: 'Find guest' })).toBeVisible()
    await expect(page.getByText('2 / 3 checked in')).toBeVisible()
    await expect(page.locator('.organizer-scanner').getByRole('alert')).toContainText(
      /No camera available|Camera could not start|Camera permission denied/,
    )
    await page.screenshot({
      path: info.outputPath('scanner-camera-fallback-390.png'),
      fullPage: true,
    })
    // Ended access is real DB truth; a stale manual selector cannot bypass it.
    const ended = await fetch(`${rest}/events?id=eq.${eventId}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${jwt(owner, 'service_role')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ starts_at: '2020-01-01T00:00:00Z', ends_at: '2020-01-01T02:00:00Z' }),
    })
    expect(ended.ok).toBe(true)
    const beforeRefund = await rpc('get_organizer_order', {
      p_event_id: eventId,
      p_order_id: paid.id,
    })
    const unused = beforeRefund.tickets.find((ticket: { status: string }) =>
      ticket.status === 'valid'
    )
    expect(
      (await rpc('redeem_owned_ticket', { p_event_id: eventId, p_ticket_id: unused.id })).outcome,
    ).toBe('invalid')
    await page.goto(`/organizer/events/${eventId}/dashboard`)
    await expect(page.getByText('Ended', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check-in closed' })).toBeDisabled()
    // Reconciliation proof uses the EXISTING SQL writer with synthetic verified
    // provider evidence. This is not a real Stripe/network webhook delivery.
    const sourceOrder = await (await fetch(
      `${rest}/orders?id=eq.${paid.id}&select=stripe_payment_intent_id,stripe_charge_id`,
      { headers: { authorization: `Bearer ${jwt(owner, 'service_role')}` } },
    )).json()
    await rpc('server_record_webhook_receipt', {
      p_stripe_event_id: 'evt_opsbrowserrefund',
      p_event_type: 'refund.updated',
      p_livemode: false,
      p_stripe_object_id: 're_opsbrowserrefund',
      p_api_version: '2026-07-29.dahlia',
      p_stripe_created_at: new Date().toISOString(),
      p_payload_sha256: 'b'.repeat(64),
    }, jwt(owner, 'service_role'))
    await rpc('server_apply_verified_refund', {
      p_stripe_event_id: 'evt_opsbrowserrefund',
      p_order_id: paid.id,
      p_stripe_refund_id: 're_opsbrowserrefund',
      p_payment_intent_id: sourceOrder[0].stripe_payment_intent_id,
      p_charge_id: sourceOrder[0].stripe_charge_id,
      p_transfer_reversal_id: 'trr_opsbrowserrefund',
      p_application_fee_refund_id: 'fr_opsbrowserrefund',
      p_amount_minor: 3001,
      p_currency: 'usd',
      p_status: 'succeeded',
      p_reason: 'requested_by_customer',
      p_reverse_transfer: true,
      p_refund_application_fee: true,
      p_transfer_reversal_amount_minor: 3001,
      p_application_fee_refund_amount_minor: 300,
      p_policy_verified: true,
      p_policy_failure_code: null,
    }, jwt(owner, 'service_role'))
    const afterRefund = await rpc('get_organizer_order', {
      p_event_id: eventId,
      p_order_id: paid.id,
    })
    expect(afterRefund.status).toBe('refunded')
    expect(afterRefund.tickets.find((ticket: { id: string }) => ticket.id === used.id).usedAt).toBe(
      used.usedAt,
    )
    expect(afterRefund.tickets.filter((ticket: { status: string }) => ticket.status === 'refunded'))
      .toHaveLength(1)
    await page.reload()
    await expect(page.locator('.ops-metrics dd')).toHaveText(['$30.01', '3 / 24', '1', '2 / 3'])
    const denied = await fetch(`${rest}/rpc/list_organizer_event_orders`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt(other)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_event_id: eventId }),
    })
    expect(denied.status).toBe(403)
    expect(await denied.text()).not.toContain('synthetic-buyer')
    const base = await fetch(`${rest}/orders?select=buyer_email`, {
      headers: { authorization: `Bearer ${jwt()}` },
    })
    expect(base.status).toBe(403)
  },
)
