import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// The fixture is written with mode 0600 by the live Storage proof, never committed.
const fixture = JSON.parse(readFileSync('.superpowers/organizer-onboarding-identity-v1/live-session.json', 'utf8')) as {
  api: string; owner: string; session: unknown
}
if (fixture.api !== 'http://127.0.0.1:59321' || !/^[0-9a-f-]{36}$/.test(fixture.owner)) throw new Error('Expected isolated proof2 fixture')
function profile() {
  return execFileSync('python3', ['tests/integration/organizer-profile-proof2.py', 'sql', 'feature'], {
    input: `select to_jsonb(o) from public.organizers o where id='${fixture.owner}';`, encoding: 'utf8', timeout: 20000,
  }).trim()
}

test('real Storage upload finishing after sign-out cannot attach media or save the old profile', async ({ page }) => {
  const before = profile()
  await page.addInitScript(session => localStorage.setItem('sb-127-auth-token', JSON.stringify(session)), fixture.session)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => void dialog.accept())
  let saveRequests = 0
  page.on('request', request => { if (request.url().includes('/rpc/save_owned_organizer_setup')) saveRequests++ })
  let signalUploaded!: () => void
  const uploaded = new Promise<void>(resolve => { signalUploaded = resolve })
  let signalDelivered!: () => void
  const delivered = new Promise<void>(resolve => { signalDelivered = resolve })
  let releaseResponse!: () => void
  const responseGate = new Promise<void>(resolve => { releaseResponse = resolve })
  await page.route('**/functions/v1/organizer-media', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    // Forward the real upload to real Storage; delay only delivery of its successful response.
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    signalUploaded()
    await responseGate
    await route.fulfill({ response })
    signalDelivered()
  })
  await page.goto('/organizer/setup')
  await expect(page.getByLabel('Organizer / business name')).toHaveValue('Storefront proof')
  await page.getByLabel('Organizer / business name').fill('Must not save after sign-out')
  await page.locator('input[type=file]').setInputFiles({
    name: 'real-logo.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'),
  })
  await page.getByRole('button', { name: 'Save & leave' }).click()
  await uploaded
  // Setup has no shell sign-out button. Invoke its actual browser Supabase client,
  // including real Auth logout and the real SessionProvider subscription.
  const signOutError = await page.evaluate(async () => {
    const moduleUrl = '/src/lib/supabase/client.ts'
    const { supabase } = await import(moduleUrl)
    const { error } = await supabase.auth.signOut()
    return error?.message ?? null
  })
  expect(signOutError).toBeNull()
  await expect(page.getByLabel('Organizer / business name')).toHaveCount(0)
  releaseResponse()
  // Wait for the real delayed response to reach the client, then a rendering turn.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sb-127-auth-token'))).toBeNull()
  await delivered
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(saveRequests).toBe(0)
  expect(profile()).toBe(before)
  expect(errors).toEqual([])
})
