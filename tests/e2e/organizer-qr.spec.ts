import { seedProofArtwork, serveProofArtwork } from './support/organizerArtwork'
import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QRCodeSVG } from 'qrcode.react'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

const rest = 'http://127.0.0.1:55436'
const owner = 'a6100000-0000-4000-8000-000000000001'
const eventId = 'a6200000-0000-4000-8000-000000000001'
const otherEvent = 'a6200000-0000-4000-8000-000000000003'
const db = 'postgresql://postgres:organizer_ops_local_only@127.0.0.1:55435/postgres'
function jwt(role = 'authenticated') {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: owner, role, exp: Math.floor(Date.now()/1000)+3600 })}`
  return `${body}.${createHmac('sha256','organizer-ops-local-only-jwt-secret-2026').update(body).digest('base64url')}`
}
async function rpc(name: string, data: unknown, role = 'authenticated') {
  const response = await fetch(`${rest}/rpc/${name}`, { method: 'POST', headers: { authorization: `Bearer ${jwt(role)}`, 'content-type': 'application/json' }, body: JSON.stringify(data) })
  if (!response.ok) throw new Error(`Local proof RPC failed: ${name} ${response.status}`)
  return response.json()
}
function seed() {
  // Fixed disposable endpoint; SQL refuses any non-fixture user namespace.
  execFileSync('psql', [db, '-X', '-v', 'ON_ERROR_STOP=1', '-f', 'tests/e2e/support/organizerQrFixture.sql'], { stdio: 'pipe' })
  seedProofArtwork()
}
declare global { interface Window { __opsProofFrame(svg: string | null): Promise<void> } }
async function frame(page: Page, credential: string | null) {
  // Use the same QR encoder and error correction as the existing buyer QR.
  const svg = credential ? renderToStaticMarkup(createElement(QRCodeSVG, { xmlns: 'http://www.w3.org/2000/svg', value: credential, size: 600, level: 'Q', marginSize: 4 })) : null
  await page.evaluate(value => window.__opsProofFrame(value), svg)
}
async function shots(page: Page, info: TestInfo, state: string) {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 800 }]) {
    await page.setViewportSize(viewport)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${state}-${viewport.width}.png`), fullPage: true, style: '.organizer-scanner__video { visibility: hidden !important; }' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
}
test('QR camera → actual admission handler → canonical SQL, all result screens', async ({ page }, info) => {
  test.setTimeout(180000)
  seed()
  await serveProofArtwork(page)
  await page.addInitScript(({ token, owner }) => {
    localStorage.setItem('sb-ops-local-auth-token', JSON.stringify({ access_token: token, refresh_token: 'local-fixture', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: 'bearer', user: { id: owner, aud: 'authenticated', role: 'authenticated', email: 'organizer@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }))
    // Only the physical camera source is replaced. Real ZXing decodes this stream.
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 640
    const context = canvas.getContext('2d')!
    let currentImage: HTMLImageElement | null = null
    let tick = 0
    function paint() {
      context!.fillStyle = '#fff'; context!.fillRect(0,0,640,640)
      // A changing corner pixel models a live camera and prevents idle-frame suppression.
      context!.fillStyle = ++tick % 2 ? '#eee' : '#fff'; context!.fillRect(0,0,1,1)
      if (currentImage) {
        // A handheld ticket changes pose; exercise multiple genuine camera frames.
        context!.save()
        context!.translate(320,320)
        context!.rotate(((tick % 13) - 6) * 2 * Math.PI / 180)
        const size = 320 + (tick % 11) * 18
        context!.drawImage(currentImage,-size/2,-size/2,size,size)
        context!.restore()
      }
    }
    window.__opsProofFrame = async svg => {
      currentImage = null
      if (svg) {
        const image = new Image()
        image.src = 'data:image/svg+xml;base64,' + btoa(svg)
        await image.decode()
        currentImage = image
      }
      paint()
    }
    paint()
    // Avoid phase-locking the camera pose to the decoder’s 500 ms retry interval.
    setInterval(paint, 83)
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [{ deviceId: 'ops-fixture', groupId: 'ops', kind: 'videoinput', label: 'Synthetic QR camera', toJSON: () => ({}) }] })
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => canvas.captureStream(10) })
  }, { token: jwt(), owner })
  let failAdmission = false
  await page.route('https://ops-local.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/functions/v1/ticket-admission') {
      if (failAdmission) { failAdmission = false; await route.fulfill({ status: 503, json: { outcome: 'network_error' } }); return }
      const response = await fetch('http://127.0.0.1:55437/admission', { method: 'POST', headers: { authorization: request.headers().authorization!, origin: 'http://127.0.0.1:3012', 'content-type': 'application/json' }, body: request.postData() })
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() }); return
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const response = await fetch(rest+url.pathname.replace('/rest/v1','')+url.search, { method: request.method(), headers: request.headers(), body: request.postData() ?? undefined })
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() }); return
    }
    await route.abort()
  })
  const list = await rpc('list_organizer_event_orders', { p_event_id: eventId })
  const paid = list.orders.find((order: { status: string }) => order.status === 'paid')
  const sourceResponse = await fetch(`${rest}/tickets?order_id=eq.${paid.id}&select=id,order_item_id,unit_sequence&order=order_item_id,unit_sequence`, { headers: { authorization: `Bearer ${jwt('service_role')}` } })
  const tickets: Array<{ id: string; order_item_id: string; unit_sequence: number }> = await sourceResponse.json()
  const credential = (ticket: typeof tickets[number]) => `wta1_${createHmac('sha256',Buffer.from('ab'.repeat(32),'hex')).update(`wheretoo:paid-admission:lite:v1\n${ticket.order_item_id}\n${ticket.unit_sequence}`).digest('base64url')}`
  await page.goto(`/organizer/events/${eventId}/check-in`)
  await expect(page.getByRole('heading', { name: 'Scan guest ticket' })).toBeVisible()
  if (process.env.WHERETO_OPERATIONS_ARTWORK_PROOF) await expect.poll(() => page.locator('.ops-scanner__art img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  await shots(page,info,'scan-ready')
  await frame(page,credential(tickets[0]!))
  await expect(page.getByRole('heading', { name: 'Admitted', exact: true })).toBeVisible()
  await expect(page.getByText('Synthetic Buyer')).toBeVisible()
  await expect(page.locator('time')).toHaveCount(1)
  await shots(page,info,'admitted')
  const first = await rpc('get_organizer_order',{ p_event_id: eventId, p_order_id: paid.id })
  const usedAt = first.tickets.find((t: { id: string }) => t.id === tickets[0]!.id).usedAt
  await frame(page,null); await page.getByRole('button',{ name: 'Scan next ticket' }).click()
  await page.getByRole('heading',{ name: 'Scan guest ticket' }).waitFor()
  await frame(page,credential(tickets[0]!))
  await expect(page.getByRole('heading',{ name: 'Already scanned' })).toBeVisible()
  await expect(page.locator('time')).toHaveAttribute('datetime',usedAt)
  await shots(page,info,'already-scanned')
  await frame(page,null); await page.getByRole('button',{ name: 'Scan next ticket' }).click()
  await page.getByRole('heading',{ name: 'Scan guest ticket' }).waitFor()
  await frame(page,`wta1_${Buffer.alloc(32,0xcd).toString('base64url')}`)
  await expect(page.getByRole('heading',{ name: 'Invalid ticket' })).toBeVisible()
  await shots(page,info,'invalid')
  await page.goto(`/organizer/events/${otherEvent}/check-in`)
  await page.getByRole('heading',{ name: 'Scan guest ticket' }).waitFor()
  await frame(page,credential(tickets[0]!))
  await expect(page.getByRole('heading',{ name: 'Wrong event' })).toBeVisible()
  await expect(page.getByText('Synthetic Buyer')).toHaveCount(0)
  await shots(page,info,'wrong-event')
  await page.goto(`/organizer/events/${eventId}/check-in`)
  await page.getByRole('heading',{ name: 'Scan guest ticket' }).waitFor()
  failAdmission = true
  await frame(page,credential(tickets[1]!))
  await expect(page.getByRole('heading',{ name: 'Network error' })).toBeVisible()
  await shots(page,info,'network-error')
  await page.getByRole('button',{ name: 'Retry check-in' }).click()
  await expect(page.getByRole('heading',{ name: 'Admitted', exact: true })).toBeVisible()
  await frame(page,null); await page.getByRole('button',{ name: 'Scan next ticket' }).click()
  await page.getByRole('heading',{ name: 'Scan guest ticket' }).waitFor()
  // Existing receipt + verified refund writer, with synthetic provider evidence.
  await rpc('server_record_webhook_receipt',{ p_stripe_event_id:'evt_opsbrowserqrrefund',p_event_type:'refund.updated',p_livemode:false,p_stripe_object_id:'re_opsbrowserqrrefund',p_api_version:'2026-07-29.dahlia',p_stripe_created_at:new Date().toISOString(),p_payload_sha256:'b'.repeat(64) },'service_role')
  await rpc('server_apply_verified_refund',{p_stripe_event_id:'evt_opsbrowserqrrefund',p_order_id:paid.id,p_stripe_refund_id:'re_opsbrowserqrrefund',p_payment_intent_id:'pi_opsbrowserqr',p_charge_id:'ch_opsbrowserqr',p_transfer_reversal_id:'trr_opsbrowserqrrefund',p_application_fee_refund_id:'fr_opsbrowserqrrefund',p_amount_minor:3001,p_currency:'usd',p_status:'succeeded',p_reason:'requested_by_customer',p_reverse_transfer:true,p_refund_application_fee:true,p_transfer_reversal_amount_minor:3001,p_application_fee_refund_amount_minor:300,p_policy_verified:true,p_policy_failure_code:null},'service_role')
  await frame(page,credential(tickets[2]!))
  await expect(page.getByRole('heading',{ name: 'Ticket refunded' })).toBeVisible()
  await shots(page,info,'refunded')
  seed()
  const nextList = await rpc('list_organizer_event_orders',{p_event_id:eventId})
  const nextOrder = nextList.orders.find((order:{status:string})=>order.status==='paid')
  const nextResponse=await fetch(`${rest}/tickets?order_id=eq.${nextOrder.id}&select=id,order_item_id,unit_sequence`,{headers:{authorization:`Bearer ${jwt('service_role')}`}})
  const [nextTicket]:typeof tickets = await nextResponse.json()
  await page.goto(`/organizer/events/${eventId}/check-in`)
  await page.getByRole('heading',{name:'Scan guest ticket'}).waitFor()
  await rpc('cancel_owned_event',{p_event_id:eventId})
  await frame(page,credential(nextTicket!))
  await expect(page.getByRole('heading',{name:'Ticket cancelled'})).toBeVisible()
  await expect(page.getByText('Check-in closed')).toBeVisible()
  await shots(page,info,'cancelled')
  await expect(page.getByRole('button',{name:'Scan next ticket'})).toHaveCount(0)
})

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return
  const state = await page.locator('video').evaluateAll(elements => elements.map(element => {
    const video = element as HTMLVideoElement
    return { width: video.videoWidth, height: video.videoHeight, paused: video.paused, time: video.currentTime, tracks: video.srcObject instanceof MediaStream ? video.srcObject.getTracks().map(track => track.readyState) : [] }
  }))
  // No pixels, credentials or buyer data in failure diagnostics.
  console.log('Synthetic camera state:', JSON.stringify(state))
})
