import { createHmac } from 'node:crypto'
import { readFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'
export const localEdge = 'http://127.0.0.1:55557'
export type Fixture = { paidOrder: string; registration: string; tickets: unknown[]; paidToken: string; freeToken: string; owner: string; paidOwner: string; freeEvent: string; paidEvent: string }
export const fixture = (): Fixture => JSON.parse(readFileSync('.superpowers/spec07/browser-fixture.json', 'utf8')) as Fixture
export function sql(statement: string): string {
  return execFileSync('python3', ['tests/integration/spec08-spec09-database.py', 'sql'], { input: statement, encoding: 'utf8' })
}
export function jwt(owner: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ role: 'authenticated', sub: owner, exp: 1893456000 })
  return body + '.' + createHmac('sha256', 'spec09-local-only-jwt-secret-disposable-2026').update(body).digest('base64url')
}
export async function connect(page: Page, owner?: string) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === 'https://spec09-local.supabase.co') {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': 'http://127.0.0.1:3027', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' } })
      const response = await route.fetch({ url: localEdge + url.pathname + url.search, headers: { ...route.request().headers(), origin: 'http://127.0.0.1:3027' } })
      return route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': 'http://127.0.0.1:3027' } })
    }
    if (url.hostname !== '127.0.0.1') return route.abort('blockedbyclient')
    return route.continue()
  })
  if (owner) await page.addInitScript(({ owner, access }) => {
    localStorage.setItem('sb-spec09-local-auth-token', JSON.stringify({ access_token: access, refresh_token: 'local-only', expires_at: 1893456000, expires_in: 9999999, token_type: 'bearer', user: { id: owner, email: 'owner@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }))
  }, { owner, access: jwt(owner) })
}
export type Message = { attemptId: string; key: string; wire: string; html: string; text: string }
export async function messages(page: Page): Promise<Message[]> { return (await page.request.get(localEdge + '/__spec07/messages')).json() as Promise<Message[]> }
export async function work(page: Page, mode = 'accepted') {
  const response = await page.request.post(localEdge + '/__spec07/work', { data: { mode } })
  if (!response.ok()) throw new Error('Local worker failed: ' + await response.text())
}
export function emailLink(message: Message) {
  const link = message.text.match(/http:\/\/127\.0\.0\.1:3027\/ticket-access#em1_[A-Za-z0-9_-]{43}/)?.[0]
  if (!link) throw new Error('Missing scoped access link in synthetic message')
  return link
}
export async function screenshot(page: Page, name: string) {
  mkdirSync('.superpowers/spec07/browser-visual', { recursive: true })
  await page.screenshot({ path: '.superpowers/spec07/browser-visual/' + name + '.png', fullPage: true })
}
