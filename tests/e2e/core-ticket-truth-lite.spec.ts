/// <reference types="vite/client" />
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { createNodeAdmissionChecker } from './support/nodeAdmissionChecker'
import { loadTask18E2EEnv } from './support/e2eEnv'
import { browserRefundRecoveryIsSafe } from './support/ticketingFixture'
import { decoderBundle, decodeMountedQr } from './support/ticketExperienceJourney'
import { chooseTwoGeneralAdmissionAndOneVip, completeHostedStripeTestPayment,
  deliverAndAssertRealPaidOrder, invokeDriver, prepareTicketingJourney } from './support/ticketingJourney'

type Snapshot = { position: number; status: string; used_at: string | null }
type Inspection = { tickets: Array<{ ticket_snapshot: Snapshot[]; used_count: number }> }

test.describe.serial('Core Ticket Truth Lite paid launch boundary', () => {
  test('real paid collection, rendered QR, authorized redemption, replay, and refund history', async ({ page }) => {
    test.setTimeout(180_000)
    if (process.env.CORE_TICKET_LITE_SHARED_APPROVED !== '1') throw new Error('SHARED_PROOF_NOT_APPROVED')
    const env = loadTask18E2EEnv()
    const clients: SupabaseClient[] = []
    let stage = 'fixture'
    try {
      const fixture = await prepareTicketingJourney()
      const bundle = await decoderBundle()
      stage = 'checkout'
      await page.goto(fixture.publicEventPath)
      stage = 'checkout_quantities'
      await chooseTwoGeneralAdmissionAndOneVip(page)
      stage = 'checkout_buyer_form'
      await page.getByRole('button', { name: 'Continue to checkout' }).click()
      await page.getByLabel('Your name').fill('Lite Proof Guest')
      await page.getByLabel('Email address').fill(fixture.buyerEmail)
      stage = 'checkout_submit'
      await page.getByRole('button', { name: 'Continue to secure payment' }).click()
      stage = 'hosted_test_payment'
      await completeHostedStripeTestPayment(page)
      stage = 'durable_payment'
      await deliverAndAssertRealPaidOrder(page, fixture)
      await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible()
      stage = 'production_collection_and_qr'
      await page.getByRole('link', { name: 'View tickets', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Your tickets', exact: true })).toBeVisible()
      const links = page.locator('.ticket-collection__list a')
      await expect(links).toHaveCount(3)
      await expect(page.getByTestId('admission-qr')).toHaveCount(0)
      const paths = await links.evaluateAll(items => items.map(item => item.getAttribute('href') ?? ''))
      expect(new Set(paths).size === 3).toBe(true)
      const credentials: string[] = []
      for (const path of paths) {
        await page.goto(path)
        const credential = await decodeMountedQr(page, bundle)
        credentials.push(credential)
        const verified = await invokeDriver<{ matches: boolean }>('verify_rendered_credential', {
          ticket_id: path.split('/').at(-1), credential,
        })
        expect(verified.matches).toBe(true)
      }
      expect(new Set(credentials).size === 3).toBe(true)
      const paid = await invokeDriver<Inspection>('inspect', { event_id: fixture.eventId })
      expect(paid.tickets[0]).toMatchObject({ ticket_count: 3, source_count: 3, unique_hash_count: 3,
        hashes_valid: true, labels_valid: true, bindings_valid: true, sequences_valid: true, used_count: 0 })

      const ownerPassword = `${randomBytes(32).toString('hex')}Aa1!`
      stage = 'organizer_auth'
      const otherPassword = `${randomBytes(32).toString('hex')}Aa1!`
      const admissionFixture = await invokeDriver<{ wrong_event_id: string }>('prepare_lite_admission', {
        owner_password: ownerPassword, other_password: otherPassword,
      })
      for (const [email, password] of [
        [`${env.task18FixturePrefix}@example.invalid`, ownerPassword],
        [`${env.task18FixturePrefix}-admission@example.invalid`, otherPassword],
      ]) {
        const client = createClient(env.supabaseUrl, env.supabasePublishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        })
        clients.push(client)
        const signedIn = await client.auth.signInWithPassword({ email, password })
        expect(signedIn.error === null && !!signedIn.data.session).toBe(true)
      }
      // Same production checker, real authenticated endpoint transport; no fixture scan outcomes.
      const owner = createNodeAdmissionChecker(clients[0], page.url())
      const other = createNodeAdmissionChecker(clients[1], page.url())
      stage = 'authoritative_admission'
      const check = (credential: string) => owner.checkAdmission({ eventId: fixture.eventId, credential })
      expect((await other.checkAdmission({ eventId: fixture.eventId, credential: credentials[1] })).outcome).toBe('network_error')
      expect((await owner.checkAdmission({ eventId: admissionFixture.wrong_event_id, credential: credentials[1] })).outcome).toBe('wrong_event')
      expect((await check(`wta1_${randomBytes(32).toString('base64url')}`)).outcome).toBe('invalid')
      expect((await check(credentials[0])).outcome).toBe('admitted')
      expect((await check(credentials[0])).outcome).toBe('already_used')
      const used = await invokeDriver<Inspection>('inspect', { event_id: fixture.eventId })
      expect(used.tickets[0].used_count).toBe(1)
      expect(used.tickets[0].ticket_snapshot.some(ticket => ticket.status === 'used' && !!ticket.used_at)).toBe(true)
      stage = 'duplicate_paid_delivery'
      const replay = await invokeDriver<{ status: number; original_set_unchanged: boolean }>('deliver_lite_paid_replay', { order_handle: 'paid', event: { event_handle: randomUUID(),
        type: 'checkout.session.completed', object: 'checkout.session', order_handle: 'paid', created: Math.floor(Date.now() / 1000) } })
      expect(replay.status).toBe(200)
      expect(replay.original_set_unchanged).toBe(true)
      const replayed = await invokeDriver<Inspection>('inspect', { event_id: fixture.eventId })
      expect(JSON.stringify(replayed.tickets[0].ticket_snapshot) === JSON.stringify(used.tickets[0].ticket_snapshot)).toBe(true)

      stage = 'whole_order_refund'
      // Creation may succeed before provider evidence enrichment returns. Do not
      // create twice: the existing recovery path verifies that exact refund.
      try { await invokeDriver('create_refund', { order_handle: 'paid' }) } catch { /* verified below */ }
      stage = 'whole_order_refund_recovery'
      const refund = await invokeDriver<Record<string, unknown>>('recover_refund', { order_handle: 'paid' })
      expect(browserRefundRecoveryIsSafe(refund, 1)).toBe(true)
      const refunded = await invokeDriver<Inspection>('inspect', { event_id: fixture.eventId })
      const priorUsed = used.tickets[0].ticket_snapshot.filter(ticket => ticket.status === 'used')
      expect(priorUsed.every(ticket => refunded.tickets[0].ticket_snapshot.some(current =>
        current.position === ticket.position && current.status === 'used' && current.used_at === ticket.used_at))).toBe(true)
      stage = 'inactive_collection_and_admission'
      for (const [index, path] of paths.entries()) {
        await page.goto(path)
        await expect(page.locator('.focused-ticket__inactive')).toContainText(index === 0 ? 'Already used' : 'Refunded')
        await expect(page.getByTestId('admission-qr')).toHaveCount(0)
        expect((await check(credentials[index])).outcome).toBe(index === 0 ? 'already_used' : 'refunded')
      }
    } catch {
      // Playwright's rich errors can include bearer paths/QR arguments. Evidence is allowlisted outcomes only.
      throw new Error(`CORE_TICKET_LITE_JOURNEY_FAILED:${stage}`)
    } finally {
      for (const client of clients) await client.auth.signOut({ scope: 'local' })
      await page.goto('about:blank')
    }
  })
})
