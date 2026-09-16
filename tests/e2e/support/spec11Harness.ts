import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, type Page, type Route } from '@playwright/test'
export const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
export function sql(statement: string): string {
  // Runner re-verifies recorded container ID, label, loopback port and cron isolation on every call.
  return execFileSync('python3', ['tests/integration/spec11-database.py', 'sql'], { input: '\\pset tuples_only on\n\\pset format unaligned\n' + statement, encoding: 'utf8' })
}
export function dbJson(statement: string): unknown {
  const output = sql(statement)
  const line = output.split('\n').find(line => line.startsWith('{') || line.startsWith('['))
  if (!line) throw new Error('Disposable DB did not return expected JSON')
  return JSON.parse(line)
}
export async function fixture(page: Page) {
  const id = randomUUID()
  sql(`insert into auth.users(id,email,raw_user_meta_data) values(${quote(id)},${quote(id + '@example.invalid')},'{"full_name":"Account Name"}'); insert into public.organizers(id,display_name,bio,organizer_type,base_city,country_code,onboarding_completed_at) values(${quote(id)},'Night Market Collective','Good food, local music and nights that bring the neighborhood together.','Venue','Oakland','US','2026-08-01');`)
  const user = { id, aud: 'authenticated', role: 'authenticated', email: 'private@example.invalid', email_confirmed_at: '2026-08-01T00:00:00Z', user_metadata: { full_name: 'Fresh Account Name' }, app_metadata: { provider: 'email', providers: ['email'] }, created_at: '2026-08-01T00:00:00Z', new_email: '' }
  const expiry = Math.floor(Date.now() / 1000) + 3600
  const token = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: id, exp: expiry, aud: 'authenticated' })).toString('base64url') + '.' + Buffer.from(randomUUID()).toString('base64url')
  const state = { user, status: 'ready', statusFail: false, statusReads: 0, sessionCreates: 0, signOuts: 0, writes: 0, unexpected: [] as string[] }
  const session = { access_token: token, refresh_token: 'local-fixture-only', token_type: 'bearer', expires_in: 3600, expires_at: expiry, user: { ...user, user_metadata: { full_name: 'Stale session name' } } }
  await page.addInitScript(session => { if (!localStorage.getItem('spec11-initialized')) { localStorage.setItem('sb-spec10-local-auth-token', JSON.stringify(session)); localStorage.setItem('spec11-initialized', 'true') } }, session)
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient'))
  await page.route('https://spec10-local.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/auth/v1/user') {
      if (route.request().method() === 'PUT') {
        // Transient request only. Never retain/log password attributes.
        const input = route.request().postDataJSON() as { data?: { full_name: string }; email?: string; password?: string }
        if (input.data) state.user.user_metadata = input.data
        if (input.email) state.user.new_email = input.email
        state.writes++
      }
      return json(route, state.user)
    }
    if (path === '/auth/v1/logout') { state.signOuts++; return route.fulfill({ status: 204 }) }
    if (path === '/auth/v1/reauthenticate') return json(route, {})
    if (path === '/rest/v1/organizers') {
      const data = dbJson(`begin; set local role authenticated; set local "request.jwt.claim.sub"=${quote(id)}; select coalesce(json_agg(row_to_json(o)),'[]'::json) from public.organizers o where id=${quote(id)}; commit;`)
      return json(route, data)
    }
    if (path.endsWith('/get_my_staff_role')) return json(route, null)
    if (path.endsWith('/save_owned_organizer_settings')) {
      const input = route.request().postDataJSON() as { p_display_name: string; p_bio: string; p_expected_updated_at: string }
      try {
        const data = dbJson(`begin; set local role authenticated; set local "request.jwt.claim.sub"=${quote(id)}; select json_agg(row_to_json(s)) from public.save_owned_organizer_settings(${quote(input.p_display_name)},${quote(input.p_bio)},${quote(input.p_expected_updated_at)}::timestamptz) s; commit;`)
        return json(route, data)
      } catch { return json(route, { code: 'P0001', message: 'ORGANIZER_SETTINGS_CONFLICT' }, 409) }
    }
    if (path.endsWith('/stripe-connect-status')) {
      state.statusReads++
      if (state.statusFail) return json(route, { error: 'fixture provider unavailable' }, 503)
      return json(route, state.status === 'not_started' ? { status: 'not_started' } : { status: state.status, requirements_currently_due_count: state.status === 'ready' ? 0 : 2, requirements_past_due_count: state.status === 'restricted' ? 1 : 0, last_status_code: null, last_synced_at: '2026-09-12T00:00:00Z' })
    }
    if (path.endsWith('/stripe-connect-session')) { state.sessionCreates++; return json(route, { error: 'fixture refuses provider creation' }, 503) }
    state.unexpected.push(path)
    return json(route, { error: 'Unexpected fixture endpoint' }, 500)
  })
  return { ...state, state, id }
}
export async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `.superpowers/spec11/visual/${name}.png`, fullPage: true, animations: 'disabled' })
}
