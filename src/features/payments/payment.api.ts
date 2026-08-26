import { supabase } from '../../lib/supabase/client'
import type { ConnectStatus } from './payment.types'

export type ConnectAccountSession = {
  clientSecret: string
  status: ConnectStatus
}

function paymentApiError(action: 'load' | 'start' | 'open'): Error {
  const messages = {
    load: 'Payment setup could not be loaded',
    start: 'Payment setup could not be started',
    open: 'Stripe Express could not be opened',
  } as const

  return new Error(messages[action])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isConnectStatus(value: unknown): value is ConnectStatus {
  if (!isRecord(value)) return false

  if (!['not_started', 'pending', 'action_required', 'restricted', 'ready'].includes(String(value.status))) {
    return false
  }

  if (value.status === 'not_started') return true

  return typeof value.requirements_currently_due_count === 'number' &&
    typeof value.requirements_past_due_count === 'number' &&
    (typeof value.last_status_code === 'string' || value.last_status_code === null) &&
    typeof value.last_synced_at === 'string'
}

async function invokePaymentFunction(name: string): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(name, { body: {}, method: 'POST' })

  if (error !== null) {
    throw error
  }

  return data
}

export async function getConnectStatus(): Promise<ConnectStatus> {
  try {
    const data = await invokePaymentFunction('stripe-connect-status')
    if (!isConnectStatus(data)) throw new Error('Unsafe status response')
    return data
  } catch {
    throw paymentApiError('load')
  }
}

export async function createConnectAccountSession(): Promise<ConnectAccountSession> {
  try {
    const data = await invokePaymentFunction('stripe-connect-session')
    if (!isRecord(data) || typeof data.client_secret !== 'string' || !isConnectStatus(data.connect_status)) {
      throw new Error('Unsafe session response')
    }

    return { clientSecret: data.client_secret, status: data.connect_status }
  } catch {
    throw paymentApiError('start')
  }
}

export async function getExpressLoginUrl(): Promise<string> {
  try {
    const data = await invokePaymentFunction('stripe-express-login')
    if (!isRecord(data) || typeof data.url !== 'string') throw new Error('Unsafe login response')

    const url = new URL(data.url)
    if (url.protocol !== 'https:') throw new Error('Unsafe login URL')
    return url.href
  } catch {
    throw paymentApiError('open')
  }
}
