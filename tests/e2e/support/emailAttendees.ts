import { readFileSync, mkdirSync } from 'node:fs'
import type { Page } from '@playwright/test'
export type EmailProofActor = { owner: string; token: string; event: string; emptyEvent?: string; order?: string; registration?: string; tier?: string }
export const emailFixture = JSON.parse(readFileSync('.superpowers/email-proof/browser.json', 'utf8')) as { api: string; edge: string; origin: string; anon: string; free: EmailProofActor; paid: EmailProofActor; other: EmailProofActor }
export async function connectEmailProof(page: Page, actor: EmailProofActor) {
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === 'https://email-proof-local.supabase.co') {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': emailFixture.origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
      const target = url.pathname === '/functions/v1/organizer-message' ? emailFixture.edge : emailFixture.api + url.pathname + url.search
      const response = await route.fetch({ url: target, headers: { ...request.headers(), origin: emailFixture.origin } })
      return route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': emailFixture.origin } })
    }
    if (url.origin !== emailFixture.origin && url.origin !== emailFixture.api && url.protocol !== 'blob:' && url.protocol !== 'data:') return route.abort('blockedbyclient')
    return route.continue()
  })
  await page.addInitScript(({ owner, token }) => {
    if (sessionStorage.getItem('email-proof-session-initialized')) return
    sessionStorage.setItem('email-proof-session-initialized', 'true')
    localStorage.setItem('sb-email-proof-local-auth-token', JSON.stringify({ access_token: token, refresh_token: 'local-fixture-only', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: 'bearer', user: { id: owner, email: 'owner@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }))
  }, actor)
}
export async function emailProofScreenshot(page: Page, name: string) {
  mkdirSync('.superpowers/email-proof/screens', { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `.superpowers/email-proof/screens/${name}.png`, fullPage: true })
}
