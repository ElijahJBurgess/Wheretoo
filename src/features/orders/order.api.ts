import { z } from 'zod'
import { supabase } from '../../lib/supabase/client'
import type { OrderConfirmation } from './order.types'

const bearerPattern = /^[A-Za-z0-9_-]{43}$/
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const confirmationSchema = z.object({
  event: z.object({
    title: z.string().min(1),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    timezone: z.string(),
    venueName: z.string().nullable(),
  }).strict(),
  tier: z.object({ name: z.string().min(1) }).strict(),
  orderNumber: z.string().min(1).max(64),
  status: z.enum(['processing', 'paid', 'failed', 'expired', 'refunded']),
}).strict()

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
