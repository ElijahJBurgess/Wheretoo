import { expect, type Page, test } from '@playwright/test'
import {
  connectEmailProof,
  emailFixture,
  type EmailProofActor,
  emailProofScreenshot,
} from './support/emailAttendees'
async function open(
  page: Page,
  actor: EmailProofActor,
  query = '',
  event = actor.event,
) {
  await connectEmailProof(page, actor)
  await page.goto(`/organizer/events/${event}/email-attendees${query}`)
  await expect(
    page.getByRole('heading', { name: 'Message attendees about this event' }),
  ).toBeVisible()
}
async function preview(page: Page) {
  await page.getByLabel('Subject', { exact: true }).fill('Doors open at six 🎉')
  await page.getByLabel('Message', { exact: true }).fill(
    'Please arrive at the main entrance.\nBring your ticket. <script>literal text</script>',
  )
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review your email' }))
    .toBeFocused()
}
test('paid Everyone, tier, inert branded preview, keyboard, desktop and double click', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await open(page, emailFixture.paid)
  await emailProofScreenshot(page, 'paid-desktop-composer')
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', /style-src 'self'/)
  await preview(page)
  await expect(page.getByLabel('Email content preview')).toContainText(
    'main entrance',
  )
  await expect(
    page.locator(
      '.organizer-email-template [style], .organizer-email-template a, .organizer-email-template script',
    ),
  ).toHaveCount(0)
  await emailProofScreenshot(page, 'paid-desktop-preview')
  await page.getByRole('button', { name: 'Edit message' }).click()
  await page.getByRole('combobox', { name: 'Audience' }).selectOption(
    emailFixture.paid.tier!,
  )
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.getByRole('button', { name: /Send to \d+ people/ }))
    .toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Edit message' })).toBeFocused()
  await page.getByRole('button', { name: /Send to \d+ people/ }).dblclick()
  await expect(
    page.getByRole('heading', { name: /Message queued for \d+ recipients/ }),
  ).toBeVisible()
  await emailProofScreenshot(page, 'paid-tier-queued')
})
test('free Everyone at 390px and individual registration queue', async ({ page }) => {
  await open(page, emailFixture.free)
  await emailProofScreenshot(page, 'free-mobile-composer')
  await preview(page)
  await emailProofScreenshot(page, 'free-mobile-preview')
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= innerWidth
    ),
  ).toBe(true)
  await page.getByRole('button', { name: /Send to \d+ people/ }).click()
  await expect(page.getByRole('heading', { name: /Message queued/ }))
    .toBeVisible()
  await page.goto(
    `/organizer/events/${emailFixture.free.event}/email-attendees?registration=${emailFixture.free.registration}`,
  )
  await expect(page.getByLabel('Audience', { exact: true })).toHaveValue(
    'Individual registration',
  )
  await preview(page)
  await page.getByRole('button', { name: 'Send to 1 people' }).click()
  await expect(
    page.getByRole('heading', { name: 'Message queued for 1 recipients.' }),
  ).toBeVisible()
  await emailProofScreenshot(page, 'free-individual-queued')
})
test('individual paid lost submit response reconciles original committed receipt after reload', async ({ page }) => {
  await open(page, emailFixture.paid, `?order=${emailFixture.paid.order}`)
  await expect(page.getByLabel('Audience', { exact: true })).toHaveValue(
    'Individual customer / order',
  )
  await preview(page)
  let requests = 0
  await page.route('**/functions/v1/organizer-message', async (route) => {
    const body = route.request().postDataJSON()
    if (body.action !== 'submit') return route.fallback()
    requests++
    await route.fetch({
      url: emailFixture.edge,
      headers: { ...route.request().headers(), origin: emailFixture.origin },
    })
    await route.abort('failed')
  })
  await page.getByRole('button', { name: /Send to \d+ people/ }).click()
  await expect(page.getByRole('heading', { name: 'Confirming your send' }))
    .toBeVisible()
  await expect(page.getByText('The result could not be confirmed. Check the original send status.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Check send status' }))
    .toBeVisible()
  await expect(page.getByLabel('Subject', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Check send status' }).click()
  await expect(page.getByRole('heading', { name: /Message queued/ }))
    .toBeVisible()
  expect(requests).toBe(1)
  await emailProofScreenshot(page, 'lost-response-reconciled')
})
test('zero recipients and closed window explain unavailable actions', async ({ page }) => {
  await open(page, emailFixture.free, '', emailFixture.free.emptyEvent)
  await preview(page)
  await expect(page.getByText(/No eligible recipients/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Send to/ })).toHaveCount(0)
  await emailProofScreenshot(page, 'zero-mobile')
  await page.route('**/functions/v1/organizer-message', async (route) => {
    if (route.request().postDataJSON().action === 'options') {
      return route.fulfill({
        json: {
          options: {
            eventId: emailFixture.free.event,
            admissionType: 'free',
            canSend: false,
            reason: 'SEND_WINDOW_CLOSED',
            deadline: null,
            replyTo: null,
            tiers: [],
          },
        },
      })
    }
    return route.fallback()
  })
  await page.goto(
    `/organizer/events/${emailFixture.free.event}/email-attendees`,
  )
  await expect(page.getByText(/The send window has closed/)).toBeVisible()
})
test('drift and limits invalidate confirmation with no automatic new send', async ({ page }) => {
  await open(page, emailFixture.paid)
  await preview(page)
  let code = 'PREVIEW_CHANGED'
  await page.route('**/functions/v1/organizer-message', async (route) => {
    if (route.request().postDataJSON().action === 'submit') {
      return route.fulfill({
        status: 409,
        json: { error: { code, submissionOutcome: 'not_queued' } },
      })
    }
    return route.fallback()
  })
  await page.getByRole('button', { name: /Send to \d+ people/ }).click()
  await expect(page.getByText(/audience or message details changed/))
    .toBeVisible()
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  code = 'LIMIT_REACHED'
  await page.getByRole('button', { name: /Send to \d+ people/ }).click()
  await expect(page.getByText(/messaging limit has been reached/)).toBeVisible()
  await emailProofScreenshot(page, 'limit-error-mobile')
})
test('unresolved null receipt survives reload, logout removes sensitive draft', async ({ page }) => {
  await open(page, emailFixture.free)
  await preview(page)
  await page.route('**/functions/v1/organizer-message', async (route) => {
    const action = route.request().postDataJSON().action
    if (action === 'submit') return route.abort('failed')
    if (action === 'receipt') return route.fulfill({ json: { receipt: null } })
    return route.fallback()
  })
  await page.getByRole('button', { name: /Send to \d+ people/ }).click()
  await page.getByRole('button', { name: 'Check send status' }).click()
  await expect(page.getByText(/No receipt is available yet/)).toBeVisible()
  const stored = await page.evaluate(() =>
    Object.entries(sessionStorage).filter(([key]) =>
      key.startsWith('organizer-message:')
    )
  )
  expect(JSON.stringify(stored)).not.toContain('main entrance')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Check send status' }))
    .toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry same send' }))
    .toHaveCount(0)
  await emailProofScreenshot(page, 'unresolved-reload-mobile')
  await page.evaluate(() => {
    localStorage.removeItem('sb-email-proof-local-auth-token')
    location.reload()
  })
  await expect(
    page.getByRole('heading', { name: 'Message attendees about this event' }),
  ).toHaveCount(0)
  await expect(page.getByText('main entrance')).toHaveCount(0)
})
test('switching accounts clears the composer before another owner can view it', async ({ page }) => {
  await open(page, emailFixture.paid)
  await page.getByLabel('Subject', { exact: true }).fill('Private owner draft')
  await page.getByLabel('Message', { exact: true }).fill('Private owner body')
  await page.evaluate((actor) => {
    const session = {
      access_token: actor.token,
      refresh_token: 'local-fixture-only',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: 'bearer',
      user: {
        id: actor.owner,
        email: 'owner@example.invalid',
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-01-01T00:00:00Z',
      },
    }
    localStorage.setItem(
      'sb-email-proof-local-auth-token',
      JSON.stringify(session),
    )
    const channel = new BroadcastChannel('sb-email-proof-local-auth-token')
    channel.postMessage({ event: 'SIGNED_IN', session })
    channel.close()
  }, emailFixture.free)
  await expect(page.getByLabel('Subject', { exact: true })).toHaveCount(0)
  await expect(page.getByText('This event is unavailable.')).toBeVisible()
  await page.goto(
    `/organizer/events/${emailFixture.free.event}/email-attendees`,
  )
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('')
})
test('sign out action clears the visible composer', async ({ page }) => {
  await open(page, emailFixture.free)
  await page.getByLabel('Subject', { exact: true }).fill('Private draft before sign out')
  await page.getByLabel('Message', { exact: true }).fill('Private message before sign out')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Message attendees about this event' })).toHaveCount(0)
  await expect(page.getByLabel('Subject', { exact: true })).toHaveCount(0)
})

test('pending preview freezes audience and content until review', async ({ page }) => {
  await open(page, emailFixture.paid)
  let release!: () => void
  const paused = new Promise<void>(resolve => { release = resolve })
  await page.route('**/functions/v1/organizer-message', async route => {
    if (route.request().postDataJSON().action === 'preview') await paused
    await route.fallback()
  })
  await page.getByLabel('Subject', { exact: true }).fill('A frozen preview')
  await page.getByLabel('Message', { exact: true }).fill('Audience and content stay together.')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Audience' })).toBeDisabled()
  await expect(page.getByLabel('Subject', { exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled()
  release()
  await expect(page.getByRole('heading', { name: 'Review your email' })).toBeFocused()
  await expect(page.getByText('Everyone', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Email content preview')).toContainText('Audience and content stay together.')
  await page.getByRole('button', { name: 'Edit message' }).click()
  await expect(page.getByRole('combobox', { name: 'Audience' })).toBeEnabled()
  await expect(page.getByLabel('Subject', { exact: true })).toBeEnabled()
})
