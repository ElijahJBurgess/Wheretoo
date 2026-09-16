import { expect, test } from '@playwright/test'
import { capture, checkoutPath, eventId, fixture, storageKey, submit, tierId, token } from './support/spec08Harness'

test('paid availability distinguishes all sold out from mixed inventory', async ({ page }) => {
  const f = await fixture(page); f.event.tiers.forEach(t => { t.availability_status = 'sold_out' })
  await page.goto(`/events/${eventId}`)
  await expect(page.getByRole('button', { name: 'Sold out', exact: true })).toBeDisabled()
  await expect(page.getByRole('link', { name: /Get tickets/ })).toHaveCount(0)
  await capture(page, 'sold-out-390')
  f.event.tiers[0]!.availability_status = 'available'; await page.reload()
  await page.getByLabel('General admission quantity').fill('1')
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Sold out', exact: true })).toHaveCount(0)
})

test('hosted checkout remains the only payment-entry surface', async ({ page }) => {
  const f = await fixture(page); await page.goto(checkoutPath); await submit(page)
  await expect(page).toHaveURL('https://checkout.stripe.com/c/pay/cs_test_Spec08Hosted')
  expect(f.creates).toHaveLength(1)
  expect(Object.keys(f.creates[0]!.body).sort()).toEqual(['buyerEmail', 'buyerName', 'clientRequestId', 'eventId', 'items'])
  expect(f.creates[0]!.bearer).toMatch(/^[A-Za-z0-9_-]{43}$/)
})

test('first stock rejection retains the full selection and permits explicit editing', async ({ page }) => {
  const f = await fixture(page); f.createCode = 'TIER_SOLD_OUT'
  await page.goto(checkoutPath); await submit(page)
  await expect(page.getByRole('heading', { name: 'Tickets no longer available' })).toBeVisible()
  await capture(page, 'stock-race-390')
  await page.getByRole('button', { name: 'Edit selection' }).click()
  await expect(page).toHaveURL(new RegExp(`/events/${eventId}/tickets`))
  await expect(page.getByLabel('General admission quantity')).toHaveValue('1')
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBeNull()
  expect(f.creates).toHaveLength(1)
})

test('timeout then stock rejection preserves identity until eventual authoritative paid', async ({ page }) => {
  const f = await fixture(page); f.createLost = true; f.payment = 'unknown'
  await page.goto(checkoutPath); await submit(page)
  await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
  const saved = await page.evaluate(key => sessionStorage.getItem(key), storageKey)
  await capture(page, 'unable-confirm-390')
  f.payment = 'processing'; await page.getByRole('button', { name: 'Check status', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible()
  f.createLost = false; f.createCode = 'TIER_SOLD_OUT'
  await page.getByRole('button', { name: 'Retry same checkout', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
  expect(f.creates).toHaveLength(2)
  expect(f.creates[1]).toEqual(f.creates[0])
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBe(saved)
  await expect(page.getByRole('button', { name: 'Edit selection' })).toHaveCount(0)
  f.payment = 'paid'; await page.getByRole('button', { name: 'Check status', exact: true }).click()
  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View tickets' })).toHaveAttribute('href', '/tickets/' + f.creates[0]!.bearer)
  expect(new Set(f.checks)).toEqual(new Set([f.creates[0]!.bearer]))
  expect(f.creates).toHaveLength(2)
})

test('uncertain attempt survives changed cart navigation and corrupt or deleted storage', async ({ page }) => {
  const f = await fixture(page); f.createLost = true
  await page.goto(checkoutPath); await submit(page)
  await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
  const saved = await page.evaluate(key => sessionStorage.getItem(key), storageKey)
  await page.goto(`/events/${eventId}/checkout?item=${tierId}%3A2`)
  await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBe(saved)
  await page.evaluate(key => sessionStorage.setItem(key, '{bad'), storageKey); await page.reload()
  await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to secure payment' })).toHaveCount(0)
  await page.evaluate(key => sessionStorage.removeItem(key), storageKey); await page.reload()
  await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
  expect(f.creates).toHaveLength(1)
})

test('cancellation awaits the original session and only then offers verified event navigation', async ({ page }) => {
  const f = await fixture(page); f.createLost = true
  await page.goto(checkoutPath); await submit(page)
  await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
  const bearer = f.creates[0]!.bearer!
  let release!: () => void; f.cancelGate = new Promise<void>(resolve => { release = resolve })
  await page.goto(`/events/${eventId}/checkout?cancel=${bearer}`)
  await expect(page.getByRole('heading', { name: 'Cancelling checkout' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Choose tickets' })).toHaveCount(0)
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).not.toBeNull()
  release(); await expect(page.getByRole('heading', { name: 'Checkout cancelled' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Choose tickets' })).toHaveAttribute('href', `/events/${eventId}/tickets?item=${tierId}%3A1`)
  await capture(page, 'cancelled-390')
  expect(f.cancels).toEqual([bearer]); expect(f.creates).toHaveLength(1)
})

test('payment wins a cancellation race without another checkout', async ({ page }) => {
  const f = await fixture(page); f.cancelCode = 'CHECKOUT_UNAVAILABLE'; f.payment = 'paid'
  await page.goto(`/events/${eventId}/checkout?cancel=${token}`)
  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View tickets' })).toHaveAttribute('href', '/tickets/' + token)
  expect(f.creates).toHaveLength(0); expect(f.checks.length).toBeGreaterThan(0); expect(new Set(f.checks)).toEqual(new Set([token])); expect(f.cancels).toEqual([token])
})

test('delayed confirmation polls the same order and email failure never changes paid truth', async ({ page }) => {
  const f = await fixture(page); await page.goto('/orders/' + token)
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible()
  await capture(page, 'processing-390')
  await expect.poll(() => f.checks.length).toBeGreaterThanOrEqual(2)
  f.payment = 'paid'; await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Ticket email status' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View tickets' })).toHaveAttribute('href', '/tickets/' + token)
  const checks = f.checks.length
  await page.getByRole('button', { name: 'Check email status' }).click()
  await expect.poll(() => f.deliveryChecks).toBe(2)
  expect(f.checks).toHaveLength(checks); expect(f.creates).toHaveLength(0)
  expect(new Set(f.checks)).toEqual(new Set([token]))
  await capture(page, 'paid-delivery-failure-390')
})

test('Spec06 real Full projection disables RSVP without a paid checkout', async ({ page }) => {
  const f = await fixture(page); f.free = true; f.full = true
  await page.goto(`/events/${eventId}`)
  await expect(page.getByRole('button', { name: 'RSVP full', exact: true })).toBeDisabled()
  await expect(page.getByRole('link', { name: 'RSVP for free' })).toHaveCount(0)
  await capture(page, 'rsvp-full-390')
  expect(f.creates).toHaveLength(0)
})

for (const width of [320, 768, 1440]) {
  test(`payment states remain readable at ${width}px without guessed navigation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' })
    const f = await fixture(page)
    for (const [status, heading] of [['payment_failed','Payment failed'],['cancelled','Checkout cancelled'],['processing','Confirming your payment'],['paid',"You're all set"]]) {
      f.payment = status!; await page.goto('/orders/' + token)
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      await expect(page.locator('a[href="/"]')).toHaveCount(0)
      await capture(page, `${status}-${width}`)
    }
  })
}

test('generic sellability rejection is unavailable, never a fabricated sales deadline', async ({ page }) => {
  const f = await fixture(page); f.createCode = 'EVENT_NOT_SELLABLE'
  await page.goto(checkoutPath); await submit(page)
  await expect(page.getByRole('heading', { name: 'Tickets unavailable', exact: true })).toBeVisible()
  await expect(page.getByText('Sales closed', { exact: true })).toHaveCount(0)
  await capture(page, 'tickets-unavailable-390')
  expect(f.creates).toHaveLength(1)
})

test('full storage loss during explicit replay cannot mint a replacement request', async ({ page }) => {
  const f = await fixture(page); f.createLost = true
  await page.goto(checkoutPath); await submit(page)
  await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
  await page.getByRole('button', { name: 'Check status', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible()
  await page.evaluate(() => sessionStorage.clear())
  await page.getByRole('button', { name: 'Retry same checkout', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect(f.creates).toHaveLength(1)
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBeNull()
})

test('expired database label cannot authorize another checkout without terminal session evidence', async ({ page }) => {
  const f = await fixture(page); f.createLost = true
  await page.goto(checkoutPath); await submit(page)
  await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
  const saved = await page.evaluate(key => sessionStorage.getItem(key), storageKey)
  const bearer = f.creates[0]!.bearer!
  f.payment = 'expired'; f.cancelCode = 'CHECKOUT_UNAVAILABLE'
  await page.goto('/orders/' + bearer)
  await expect(page.getByRole('heading', { name: 'Checkout expired' })).toBeVisible()
  await page.getByRole('button', { name: 'Verify before choosing tickets' }).click()
  await expect(page.getByText('Unable to confirm that checkout has ended. Keep this order and check again.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Choose tickets' })).toHaveCount(0)
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBe(saved)
  expect(f.creates).toHaveLength(1)
})

test('Spec06 positive capacity shortage is not RSVP Full and preserves its own recovery', async ({ page }) => {
  const f = await fixture(page); f.free = true
  await page.goto(`/events/${eventId}/rsvp`)
  await page.getByRole('button', { name: 'Increase quantity' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Full name').fill('Fixture Guest')
  await page.getByLabel('Email address').fill('fixture@example.invalid')
  await page.getByRole('button', { name: 'Confirm RSVP', exact: true }).click()
  await expect(page.getByText(/There is not enough room for this quantity. 1 admission remain./)).toBeVisible()
  await expect(page.getByRole('button', { name: 'RSVP full', exact: true })).toHaveCount(0)
  await capture(page, 'rsvp-quantity-shortage-390')
  expect(f.creates).toHaveLength(0)
})

test('uncertain confirmation supports keyboard status retry and never invents event navigation', async ({ page }) => {
  const f = await fixture(page); f.payment = 'unknown'
  await page.goto('/orders/' + token)
  await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
  const retry = page.getByRole('button', { name: 'Try again' })
  await retry.focus(); await page.keyboard.press('Enter')
  await expect.poll(() => f.checks.length).toBe(2)
  await expect(page.locator('a[href^="/events/"]')).toHaveCount(0)
  await expect(page.locator('a[href="/"]')).toHaveCount(0)
  await capture(page, 'confirmation-unknown-390')
})

test('failed cancellation restores verified original cart for same-session retry despite sold-out public tiers', async ({ page }) => {
  const f = await fixture(page); f.createLost = true
  await page.goto(checkoutPath); await submit(page)
  await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
  const original = f.creates[0]!
  f.cancelCode = 'CHECKOUT_UNAVAILABLE'; f.event.tiers.forEach(t => { t.availability_status = 'sold_out' })
  await page.goto(`/events/${eventId}/checkout?cancel=${original.bearer}`)
  await expect(page.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible()
  await page.getByRole('button', { name: 'Re-enter original details' }).click()
  await expect(page.getByRole('heading', { name: 'Re-enter the original buyer details' })).toBeVisible()
  await page.getByLabel('Your name', { exact: true }).fill('Fixture Buyer')
  await page.getByLabel('Email address', { exact: true }).fill('changed@example.invalid')
  await page.getByRole('button', { name: 'Retry same checkout', exact: true }).click()
  await expect(page.getByText('Resolve your existing checkout before changing buyer details or tickets.')).toBeVisible()
  expect(f.creates).toHaveLength(1)
  await page.getByLabel('Email address', { exact: true }).fill('fixture@example.invalid')
  f.createLost = false
  await page.getByRole('button', { name: 'Retry same checkout', exact: true }).click()
  await expect(page).toHaveURL('https://checkout.stripe.com/c/pay/cs_test_Spec08Hosted')
  expect(f.creates).toHaveLength(2); expect(f.creates[1]).toEqual(original)
})

for (const width of [320, 768, 1440]) {
  test(`availability and uncertain recovery adapt at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' })
    const f = await fixture(page)
    f.event.tiers.forEach(t => { t.availability_status = 'sold_out' })
    await page.goto(`/events/${eventId}`)
    await expect(page.getByRole('button', { name: 'Sold out', exact: true })).toBeDisabled()
    await capture(page, `sold-out-${width}`)
    f.free = true; f.full = true; await page.reload()
    await expect(page.getByRole('button', { name: 'RSVP full', exact: true })).toBeDisabled()
    await capture(page, `rsvp-full-${width}`)
    f.free = false; f.event.tiers.forEach(t => { t.availability_status = 'available' })
    for (const [code, heading, name] of [['EVENT_NOT_SELLABLE','Tickets unavailable','tickets-unavailable'],['TIER_SOLD_OUT','Tickets no longer available','stock-race']]) {
      // Each fixture starts after a definitive non-reservation result, not an uncertain purchase.
      await page.evaluate(() => sessionStorage.clear()); f.createCode = code!
      await page.goto(checkoutPath); await submit(page)
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      await capture(page, `${name}-${width}`)
    }
    await page.evaluate(() => sessionStorage.clear()); f.createCode = null; f.createLost = true
    await page.goto(checkoutPath); await submit(page)
    await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
    await capture(page, `unable-confirm-${width}`)
    const bearer = f.creates.at(-1)!.bearer!
    await page.goto(`/events/${eventId}/checkout?cancel=${bearer}`)
    await expect(page.getByRole('heading', { name: 'Checkout cancelled' })).toBeVisible()
    await capture(page, `verified-cancelled-${width}`)
    f.payment = 'unknown'; await page.goto('/orders/' + token)
    await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
    await capture(page, `confirmation-unknown-${width}`)
  })
}

test('terminal failure offers a new selection only after verified cancellation', async ({ page }) => {
  const f = await fixture(page); f.createLost = true
  await page.goto(checkoutPath); await submit(page)
  await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
  f.payment = 'payment_failed'; await page.goto('/orders/' + f.creates[0]!.bearer)
  await expect(page.getByRole('heading', { name: 'Payment failed' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Choose tickets' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Verify before choosing tickets' }).click()
  const selection = page.getByRole('link', { name: 'Choose tickets' })
  await expect(selection).toHaveAttribute('href', `/events/${eventId}/tickets?item=${tierId}%3A1`)
  await expect(selection).toHaveClass(/buyer-primary/)
  await capture(page, 'payment-failed-verified-390')
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBeNull()
  expect(f.creates).toHaveLength(1)
})


test('original View tickets opens the same collection after uncertain payment resolves paid', async ({ page }) => {
  const f = await fixture(page); f.createLost = true; f.payment = 'unknown'
  await page.goto(checkoutPath); await submit(page)
  await expect(page.getByRole('heading', { name: 'Unable to confirm payment' })).toBeVisible()
  const bearer = f.creates[0]!.bearer!
  f.payment = 'paid'; await page.getByRole('button', { name: 'Check status', exact: true }).click()
  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible()
  await page.getByRole('link', { name: 'View tickets' }).click()
  // The original collection UI opens its sole ticket directly.
  await expect(page.getByRole('heading', { name: 'Ticket 1', exact: true })).toBeVisible()
  await expect(page).toHaveURL('/tickets/' + bearer)
  await expect(page.getByLabel('Admission QR code')).toBeVisible()
  const qr = await page.getByLabel('Admission QR code').evaluate(node => (node as HTMLCanvasElement).toDataURL())
  await page.reload(); await expect(page.getByLabel('Admission QR code')).toBeVisible()
  expect(await page.getByLabel('Admission QR code').evaluate(node => (node as HTMLCanvasElement).toDataURL())).toBe(qr)
  expect(new Set(f.collectionReads)).toEqual(new Set([bearer])); expect(f.creates).toHaveLength(1)
  await capture(page, 'original-ticket-after-uncertainty-390')
})
