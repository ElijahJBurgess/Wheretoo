import { z } from 'zod'
import { supabase } from '../../lib/supabase/client'
import type { OrderConfirmation } from './order.types'

const bearerPattern = /^[A-Za-z0-9_-]{43}$/
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const safeMoneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const confirmationItemSchema = z.object({
  tierName: z.string().min(1),
  quantity: z.number().int().min(1).max(10),
  unitAmountMinor: safeMoneySchema.min(1),
  subtotalMinor: safeMoneySchema.min(1),
  currency: z.literal('usd'),
}).strict().refine(
  (item) => Number.isSafeInteger(item.unitAmountMinor * item.quantity) &&
    item.subtotalMinor === item.unitAmountMinor * item.quantity,
)

const confirmationSchema = z.object({
  event: z.object({
    title: z.string().min(1),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    timezone: z.string(),
    venueName: z.string().nullable(),
  }).strict(),
  items: z.array(confirmationItemSchema).min(1).max(10),
  orderNumber: z.string().min(1).max(64),
  status: z.enum(['processing', 'paid', 'payment_failed', 'cancelled', 'expired', 'refunded', 'requires_review']),
  quantity: z.number().int().min(1).max(10),
  currency: z.literal('usd'),
  subtotalMinor: safeMoneySchema.min(1),
  taxAmountMinor: z.literal(0),
  totalMinor: safeMoneySchema.min(1),
}).strict().superRefine((confirmation, context) => {
  const quantity = confirmation.items.reduce((sum, item) => sum + item.quantity, 0)
  const subtotalMinor = confirmation.items.reduce((sum, item) => sum + item.subtotalMinor, 0)
  if (
    !Number.isSafeInteger(quantity) || !Number.isSafeInteger(subtotalMinor) ||
    quantity !== confirmation.quantity || subtotalMinor !== confirmation.subtotalMinor ||
    confirmation.totalMinor !== confirmation.subtotalMinor + confirmation.taxAmountMinor
  ) {
    context.addIssue({ code: 'custom', message: 'Incoherent confirmation totals' })
  }
})

export type OrderApiErrorCode = 'ORDER_NOT_FOUND' | 'ORDER_UNAVAILABLE'

export class OrderApiError extends Error {
  constructor(readonly code: OrderApiErrorCode) {
    super(code)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCanonicalBearer(value: string): boolean {
  if (!bearerPattern.test(value)) return false
  try {
    const standard = value.replaceAll('-', '+').replaceAll('_', '/') + '='
    const bytes = Uint8Array.from(atob(standard), (character) => character.charCodeAt(0))
    let binary = ''
    bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
    return bytes.length === 32 && btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '') === value
  } catch {
    return false
  }
}

export async function fingerprintConfirmationToken(confirmationToken: string): Promise<string> {
  if (!isCanonicalBearer(confirmationToken)) throw new OrderApiError('ORDER_NOT_FOUND')
  const bytes = new TextEncoder().encode(confirmationToken)
  const input = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(input).set(bytes)
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', input)))
}

async function safeErrorCode(error: unknown): Promise<OrderApiErrorCode> {
  if (!isRecord(error) || !(error.context instanceof Response)) return 'ORDER_UNAVAILABLE'
  try {
    const body: unknown = await error.context.clone().json()
    return isRecord(body) && isRecord(body.error) && body.error.code === 'ORDER_NOT_FOUND'
      ? 'ORDER_NOT_FOUND'
      : 'ORDER_UNAVAILABLE'
  } catch {
    return 'ORDER_UNAVAILABLE'
  }
}

export async function getOrderConfirmation(confirmationToken: string): Promise<OrderConfirmation> {
  if (!isCanonicalBearer(confirmationToken)) throw new OrderApiError('ORDER_NOT_FOUND')
  const { data, error } = await supabase.functions.invoke('order-confirmation', {
    body: { confirmationToken },
    method: 'POST',
  })
  if (error !== null) throw new OrderApiError(await safeErrorCode(error))
  const parsed = confirmationSchema.safeParse(data)
  if (!parsed.success) throw new OrderApiError('ORDER_UNAVAILABLE')
  return parsed.data
}
