import { expect, test } from '@playwright/test'
import { capture, fixture, sql, quote } from './support/spec11Harness'

test('all Settings routes survive refresh and expose explicit mobile Back; four viewport visual proof', async ({ page }) => {
  const f = await fixture(page)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [path, heading] of [['', 'Settings'], ['account', 'Account & Security'], ['profile', 'Organizer Profile'], ['payments', 'Payments & Payouts'], ['help', 'Help & Legal'], ['actions', 'Account Actions']]) {
      await page.goto('/organizer/settings' + (path ? '/' + path : ''))
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      if (path) await expect(page.getByRole('link', { name: 'Back to Settings' })).toBeVisible()
      await capture(page, `${path || 'index'}-${width}`)
    }
  }
  await page.reload(); await expect(page.getByRole('heading', { name: 'Account Actions' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Settings' }).click()
  await expect(page).toHaveURL(/\/organizer\/settings$/)
  expect(f.state.sessionCreates).toBe(0); expect(f.state.unexpected).toEqual([]); expect(errors).toEqual([])
})

test('fresh Auth account identity, independent name update, and pending email', async ({ page }) => {
  const f = await fixture(page)
  await page.goto('/organizer/settings/account')
  await expect(page.getByText('Fresh Account Name', { exact: true })).toBeVisible()
  await expect(page.getByText('Stale session name')).toHaveCount(0)
  await page.getByRole('button', { name: 'Edit account name' }).click()
  await page.getByRole('textbox', { name: 'Account name', exact: true }).fill('New Private Name')
  await page.getByRole('button', { name: 'Save account name' }).click()
  await expect(page.getByText('Account name updated.')).toBeVisible()
  await page.getByRole('button', { name: 'Change login email' }).click()
  await page.getByLabel('New login email').fill('pending@example.invalid')
  await page.getByRole('button', { name: 'Request email change' }).click()
  await expect(page.getByText('pending@example.invalid', { exact: true })).toBeVisible()
  await expect(page.getByText('private@example.invalid', { exact: true })).toBeVisible()
  await page.goto('/organizer/settings/profile')
  await expect(page.getByLabel('Organizer display name')).toHaveValue('Night Market Collective')
  await expect(page.getByText('New Private Name')).toHaveCount(0)
  expect(f.state.writes).toBe(2)
})

test('database-backed profile persistence, private preview, stale conflict, explicit reapply and dirty navigation', async ({ page }) => {
  const f = await fixture(page)
  await page.goto('/organizer/settings/profile')
  await page.getByLabel('Organizer display name').fill('Night Market Together')
  await expect(page.getByText(/Changing your public organizer name sends/)).toBeVisible()
  const preview = page.getByRole('region', { name: 'Profile preview — not a public page' })
  await expect(preview).toContainText('Night Market Together'); await expect(preview).not.toContainText('@')
  await page.getByRole('button', { name: 'Save profile', exact: true }).click()
  await expect(page.getByText('Organizer profile saved.')).toBeVisible()
  await page.reload(); await expect(page.getByLabel('Organizer display name')).toHaveValue('Night Market Together')
  await page.getByRole('textbox', { name: 'Bio', exact: true }).fill('My retained draft')
  sql(`begin; set local role authenticated; set local "request.jwt.claim.sub"=${quote(f.id)}; select public.save_owned_organizer_settings('Another saved name','Concurrent edit',(select updated_at from public.organizers where id=${quote(f.id)})); commit;`)
  await page.getByRole('button', { name: 'Save profile', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('changed elsewhere')
  await expect(page.getByRole('textbox', { name: 'Bio', exact: true })).toHaveValue('My retained draft')
  await page.getByRole('button', { name: 'Review latest saved profile' }).click()
  await expect(page.getByText('Concurrent edit', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Keep my draft for the reviewed version' }).click()
  await page.getByRole('button', { name: 'Save profile', exact: true }).click()
  await expect(page.getByText('Organizer profile saved.')).toBeVisible()
  await page.getByRole('textbox', { name: 'Bio', exact: true }).fill('Unsaved')
  await page.getByRole('link', { name: 'Back to Settings' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page.getByRole('textbox', { name: 'Bio', exact: true })).toHaveValue('Unsaved')
  await page.getByRole('link', { name: 'Back to Settings' }).click()
  await page.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page).toHaveURL(/\/organizer\/settings$/)
})

test('five canonical Stripe states, refresh on return, provider failure and no mount creation', async ({ page }) => {
  const f = await fixture(page)
  const states = [ ['not_started', 'Set up payments'], ['pending', 'Payment setup is in progress'], ['action_required', 'Payment setup needs your attention'], ['restricted', 'Payment setup needs an update'], ['ready', 'Stripe setup ready for paid ticket sales'] ]
  for (const [status, title] of states) {
    f.state.status = status
    await page.goto('/organizer/settings/payments')
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.getByText(/Charges enabled|Payout status Active|Bank account configured/)).toHaveCount(0)
  }
  const reads = f.state.statusReads
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))
  await expect.poll(() => f.state.statusReads).toBeGreaterThan(reads)
  f.state.statusFail = true; await page.reload()
  await expect(page.getByRole('alert').filter({ hasText: 'Payment setup could not load' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Set up payments' })).toHaveCount(0)
  expect(f.state.sessionCreates).toBe(0)
  f.state.statusFail = false; await page.getByRole('button', { name: 'Try again' }).click()
  await page.getByRole('button', { name: 'Manage payment details' }).click()
  await expect(page.getByRole('alert')).toContainText('could not be opened')
  expect(f.state.sessionCreates).toBe(1)
})

test('missing support/legal/closure config stays honest and signout preserves unrelated guest state', async ({ page }) => {
  const f = await fixture(page)
  await page.goto('/organizer/settings/help')
  await expect(page.getByText('Support contact is currently unavailable.')).toBeVisible()
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0)
  await page.goto('/organizer/settings/actions')
  await expect(page.getByText('Account closure requests are currently unavailable.')).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('whereto-guest-preservation-proof', 'guest-link-state'))
  await page.getByRole('button', { name: 'Sign out', exact: true }).last().click()
  await expect(page).toHaveURL(/\/auth\/sign-in$/)
  await expect(page.getByText('You have signed out.')).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('whereto-guest-preservation-proof'))).toBe('guest-link-state')
  expect(f.state.signOuts).toBe(1); expect(f.state.unexpected).toEqual([])
})

test('anonymous Settings deep link is guarded', async ({ page }) => {
  await fixture(page)
  await page.goto('/organizer/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await page.evaluate(() => localStorage.removeItem('sb-spec10-local-auth-token'))
  await page.goto('/organizer/settings/profile')
  await expect(page).toHaveURL(/\/auth\/sign-in/)
  await expect(page.getByLabel('Organizer display name')).toHaveCount(0)
})
