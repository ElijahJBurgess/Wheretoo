import { supabase } from '../../lib/supabase/client'
import { checkoutInputSchema, type CheckoutInput } from './checkout.schemas'

const safeCheckoutCodes = new Set([
  'CHECKOUT_EXPIRED',
  'CHECKOUT_NOT_FOUND',
  'CONNECT_ACTION_REQUIRED',
  'CONNECT_NOT_READY',
  'EVENT_NOT_FOUND',
  'EVENT_NOT_SELLABLE',
  'RATE_LIMITED',
  'TIER_NOT_ACTIVE',
  'TIER_NOT_FOUND',
  'TIER_SOLD_OUT',
])

export type CheckoutApiErrorCode =
  | 'CHECKOUT_EXPIRED'
  | 'CHECKOUT_NOT_FOUND'
  | 'CHECKOUT_UNAVAILABLE'
  | 'CONNECT_ACTION_REQUIRED'
  | 'CONNECT_NOT_READY'
  | 'EVENT_NOT_FOUND'
  | 'EVENT_NOT_SELLABLE'
  | 'RATE_LIMITED'
  | 'TIER_NOT_ACTIVE'
  | 'TIER_NOT_FOUND'
  | 'TIER_SOLD_OUT'

export class CheckoutApiError extends Error {
  constructor(readonly code: CheckoutApiErrorCode) {
    super(code)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function errorCodeFromBody(value: unknown): CheckoutApiErrorCode | null {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.code !== 'string') return null
  return safeCheckoutCodes.has(value.error.code) ? value.error.code as CheckoutApiErrorCode : null
}

async function safeErrorCode(error: unknown): Promise<CheckoutApiErrorCode> {
  if (!isRecord(error) || !(error.context instanceof Response)) return 'CHECKOUT_UNAVAILABLE'
  try {
    return errorCodeFromBody(await error.context.clone().json()) ?? 'CHECKOUT_UNAVAILABLE'
  } catch {
    return 'CHECKOUT_UNAVAILABLE'
  }
}

export function isStripeCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.hostname === 'checkout.stripe.com' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      /^\/c\/pay\/cs_test_[A-Za-z0-9]+$/.test(url.pathname)
  } catch {
    return false
  }
}

async function invokeCheckoutFunction(name: 'stripe-create-checkout' | 'stripe-cancel-checkout', body: Record<string, string>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(name, { body, method: 'POST' })
  if (error !== null) throw new CheckoutApiError(await safeErrorCode(error))
  return data
}

export async function createCheckout(input: CheckoutInput): Promise<string> {
  const parsed = checkoutInputSchema.safeParse(input)
  if (!parsed.success) throw new CheckoutApiError('CHECKOUT_UNAVAILABLE')

  const data = await invokeCheckoutFunction('stripe-create-checkout', {
    eventId: parsed.data.eventId,
    tierId: parsed.data.tierId,
    guestName: parsed.data.buyerName,
    guestEmail: parsed.data.buyerEmail,
    clientRequestId: parsed.data.clientRequestId,
  })
  if (!isRecord(data) || Object.keys(data).length !== 1 || typeof data.checkoutUrl !== 'string' || !isStripeCheckoutUrl(data.checkoutUrl)) {
    throw new CheckoutApiError('CHECKOUT_UNAVAILABLE')
  }
  return data.checkoutUrl
}

export async function cancelCheckout(confirmationToken: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(confirmationToken)) throw new CheckoutApiError('CHECKOUT_UNAVAILABLE')
  const data = await invokeCheckoutFunction('stripe-cancel-checkout', { confirmationToken })
  if (!isRecord(data) || Object.keys(data).length !== 1 || data.cancelled !== true) {
    throw new CheckoutApiError('CHECKOUT_UNAVAILABLE')
  }
}
