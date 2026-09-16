// Materialized temporarily by the dev-world operator, never a public application route.
import { getStripe } from '../../../../supabase/functions/_shared/stripeClient.ts'
import { ACCOUNT_INCLUDE, validateApprovedConnectAccount, toSafeConnectStatus } from '../../../../supabase/functions/stripe-connect-session/connect.ts'
Deno.serve(async request => {
  const token = Deno.env.get('DEV_WORLD_PROBE_TOKEN')
  if (!token || request.method !== 'POST' || request.headers.get('x-dev-world-token') !== token) return new Response(null, { status: 404 })
  try {
    const body = await request.json()
    if (!/^acct_[A-Za-z0-9]+$/.test(body.account)) throw new Error('ACCOUNT_INVALID')
    const account = await getStripe().v2.core.accounts.retrieve(body.account, { include: ACCOUNT_INCLUDE })
    if (account.livemode !== false || account.id !== body.account) throw new Error('TEST_ACCOUNT_REQUIRED')
    const status = toSafeConnectStatus(validateApprovedConnectAccount(account), new Date().toISOString())
    const appBaseUrl = Deno.env.get('APP_BASE_URL')
    return Response.json({ ready: status.status === 'ready', test: true, appBaseUrl })
  } catch {
    return Response.json({ ready: false, error: 'TEST_ACCOUNT_READINESS_FAILED' }, { status: 409 })
  }
})
