import { randomBytes, randomUUID } from 'node:crypto'

export const TASK17_PERCENT_BPS = 500
export const TASK17_FIXED_MINOR = 50

export const TASK17_CART = [
  {
    label: 'ga',
    name: 'Task 17 General Admission',
    unitAmountMinor: 1_500,
    quantity: 2,
    subtotalMinor: 3_000,
  },
  {
    label: 'vip',
    name: 'Task 17 VIP',
    unitAmountMinor: 2_500,
    quantity: 1,
    subtotalMinor: 2_500,
  },
] as const

export const TASK17_ADMISSION_QUANTITY = 3
export const TASK17_SUBTOTAL_MINOR = 5_500

export function applicationFeeMinor(subtotalMinor: number, quantity: number): number {
  return Math.floor((subtotalMinor * TASK17_PERCENT_BPS) / 10_000) + TASK17_FIXED_MINOR * quantity
}

export const TASK17_APPLICATION_FEE_MINOR = applicationFeeMinor(
  TASK17_SUBTOTAL_MINOR,
  TASK17_ADMISSION_QUANTITY,
)
export const TASK17_ORGANIZER_PROCEEDS_MINOR = TASK17_SUBTOTAL_MINOR - TASK17_APPLICATION_FEE_MINOR

export function createStripeProofCheckoutAttempt(): {
  clientRequestId: string
  confirmationBearer: string
} {
  return {
    clientRequestId: randomUUID(),
    confirmationBearer: randomBytes(32).toString('base64url'),
  }
}

export type HostedCheckoutBrowserStage =
  | 'BROWSER_LAUNCH'
  | 'CHECKOUT_URL_OPEN'
  | 'HOSTED_DOCUMENT_LOAD'
  | 'PAYMENT_METHOD_FORM'
  | 'CARD_NUMBER'
  | 'CARD_EXPIRATION'
  | 'CARD_CVC'
  | 'CARDHOLDER_NAME'
  | 'POSTAL_CODE'
  | 'OPTIONAL_SAVE_CONTROL'
  | 'AUXILIARY_DISCLOSURE_CONTROL'
  | 'PAYMENT_SUBMISSION_ACTIONABILITY'
  | 'PAYMENT_SUBMISSION_DISPATCH'
  | 'PROVIDER_DISPOSITION'
  | 'LOCAL_RETURN_REDIRECT'

export type HostedCheckoutBrowserCheckpoint =
  | HostedCheckoutBrowserStage
  | 'PROVIDER_ACCEPTED'
  | 'PROVIDER_REJECTED'
  | 'LOCAL_RETURN_REDIRECT_OBSERVED'

export type HostedCheckoutBrowserDiagnostic = {
  stage: HostedCheckoutBrowserStage
  failure: 'NONE' | 'TIMEOUT' | 'BROWSER'
  submission: 'NOT_ATTEMPTED' | 'ATTEMPTED'
  provider: 'NOT_OBSERVED' | 'ACCEPTED' | 'REJECTED'
  redirect: 'NOT_OBSERVED' | 'OBSERVED'
}

const hostedCheckoutBrowserCheckpoints = new Set<HostedCheckoutBrowserCheckpoint>([
  'BROWSER_LAUNCH',
  'CHECKOUT_URL_OPEN',
  'HOSTED_DOCUMENT_LOAD',
  'PAYMENT_METHOD_FORM',
  'CARD_NUMBER',
  'CARD_EXPIRATION',
  'CARD_CVC',
  'CARDHOLDER_NAME',
  'POSTAL_CODE',
  'OPTIONAL_SAVE_CONTROL',
  'AUXILIARY_DISCLOSURE_CONTROL',
  'PAYMENT_SUBMISSION_ACTIONABILITY',
  'PAYMENT_SUBMISSION_DISPATCH',
  'PROVIDER_DISPOSITION',
  'PROVIDER_ACCEPTED',
  'PROVIDER_REJECTED',
  'LOCAL_RETURN_REDIRECT',
  'LOCAL_RETURN_REDIRECT_OBSERVED',
])

const postSubmissionCheckpoints = new Set<HostedCheckoutBrowserCheckpoint>([
  'PROVIDER_DISPOSITION',
  'PROVIDER_ACCEPTED',
  'PROVIDER_REJECTED',
  'LOCAL_RETURN_REDIRECT',
  'LOCAL_RETURN_REDIRECT_OBSERVED',
])

const hostedCheckoutBrowserStages = new Set<HostedCheckoutBrowserStage>([
  'BROWSER_LAUNCH',
  'CHECKOUT_URL_OPEN',
  'HOSTED_DOCUMENT_LOAD',
  'PAYMENT_METHOD_FORM',
  'CARD_NUMBER',
  'CARD_EXPIRATION',
  'CARD_CVC',
  'CARDHOLDER_NAME',
  'POSTAL_CODE',
  'OPTIONAL_SAVE_CONTROL',
  'AUXILIARY_DISCLOSURE_CONTROL',
  'PAYMENT_SUBMISSION_ACTIONABILITY',
  'PAYMENT_SUBMISSION_DISPATCH',
  'PROVIDER_DISPOSITION',
  'LOCAL_RETURN_REDIRECT',
])

const diagnosticFailures = new Set(['NONE', 'TIMEOUT', 'BROWSER'])
const diagnosticSubmissions = new Set(['NOT_ATTEMPTED', 'ATTEMPTED'])
const diagnosticProviders = new Set(['NOT_OBSERVED', 'ACCEPTED', 'REJECTED'])
const diagnosticRedirects = new Set(['NOT_OBSERVED', 'OBSERVED'])

const safeBrowserDiagnosticFallback: HostedCheckoutBrowserDiagnostic = {
  stage: 'BROWSER_LAUNCH',
  failure: 'BROWSER',
  submission: 'NOT_ATTEMPTED',
  provider: 'NOT_OBSERVED',
  redirect: 'NOT_OBSERVED',
}

type HostedCheckoutBrowserObservedState = Pick<
  HostedCheckoutBrowserDiagnostic,
  'submission' | 'provider' | 'redirect'
>

function createHostedCheckoutBrowserDiagnostic(
  candidate: HostedCheckoutBrowserCheckpoint | string,
  error: unknown,
  observed?: HostedCheckoutBrowserObservedState,
): HostedCheckoutBrowserDiagnostic {
  const checkpoint = hostedCheckoutBrowserCheckpoints.has(candidate as HostedCheckoutBrowserCheckpoint)
    ? candidate as HostedCheckoutBrowserCheckpoint
    : 'BROWSER_LAUNCH'
  const stage: HostedCheckoutBrowserStage =
    checkpoint === 'PROVIDER_ACCEPTED' || checkpoint === 'PROVIDER_REJECTED'
      ? 'PROVIDER_DISPOSITION'
      : checkpoint === 'LOCAL_RETURN_REDIRECT_OBSERVED'
        ? 'LOCAL_RETURN_REDIRECT'
        : checkpoint
  const submission = observed?.submission ?? (
    postSubmissionCheckpoints.has(checkpoint) ? 'ATTEMPTED' : 'NOT_ATTEMPTED'
  )
  const provider = observed?.provider ?? (
    checkpoint === 'PROVIDER_ACCEPTED' || checkpoint === 'LOCAL_RETURN_REDIRECT_OBSERVED'
      ? 'ACCEPTED'
      : checkpoint === 'PROVIDER_REJECTED'
        ? 'REJECTED'
        : 'NOT_OBSERVED'
  )
  const redirect = observed?.redirect ?? (
    checkpoint === 'LOCAL_RETURN_REDIRECT_OBSERVED' ? 'OBSERVED' : 'NOT_OBSERVED'
  )
  const failure = error === undefined
    ? 'NONE'
    : error instanceof Error && (
        error.name === 'TimeoutError' || /(?:timed?\s*out|timeout)/i.test(error.message)
      )
      ? 'TIMEOUT'
      : 'BROWSER'

  return { stage, failure, submission, provider, redirect }
}

export function hostedCheckoutBrowserDiagnostic(
  candidate: HostedCheckoutBrowserCheckpoint | string,
  error?: unknown,
): HostedCheckoutBrowserDiagnostic {
  return createHostedCheckoutBrowserDiagnostic(candidate, error)
}

export function formatHostedCheckoutBrowserDiagnostic(
  candidate: unknown,
): string {
  let diagnostic = safeBrowserDiagnosticFallback
  try {
    if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate) &&
      Object.keys(candidate).sort().join(',') ===
        ['failure', 'provider', 'redirect', 'stage', 'submission'].join(',')) {
      const value = candidate as Record<string, unknown>
      const stage = value.stage
      const failure = value.failure
      const submission = value.submission
      const provider = value.provider
      const redirect = value.redirect
      if (hostedCheckoutBrowserStages.has(stage as HostedCheckoutBrowserStage) &&
        diagnosticFailures.has(failure as string) &&
        diagnosticSubmissions.has(submission as string) &&
        diagnosticProviders.has(provider as string) &&
        diagnosticRedirects.has(redirect as string)) {
        diagnostic = {
          stage: stage as HostedCheckoutBrowserStage,
          failure: failure as HostedCheckoutBrowserDiagnostic['failure'],
          submission: submission as HostedCheckoutBrowserDiagnostic['submission'],
          provider: provider as HostedCheckoutBrowserDiagnostic['provider'],
          redirect: redirect as HostedCheckoutBrowserDiagnostic['redirect'],
        }
      }
    }
  } catch {
    diagnostic = safeBrowserDiagnosticFallback
  }
  return `stage=${diagnostic.stage} failure=${diagnostic.failure} ` +
    `submission=${diagnostic.submission} provider=${diagnostic.provider} ` +
    `redirect=${diagnostic.redirect}`
}

export function toSafeHostedCheckoutBrowserError(
  error: unknown,
  checkpoint: HostedCheckoutBrowserCheckpoint = 'BROWSER_LAUNCH',
  observed?: HostedCheckoutBrowserObservedState,
): Error {
  const diagnostic = createHostedCheckoutBrowserDiagnostic(checkpoint, error, observed)
  return new Error(
    `Hosted Checkout browser diagnostic: ${formatHostedCheckoutBrowserDiagnostic(diagnostic)}`,
  )
}

export type HostedCheckoutBrowserActions = {
  launchBrowser(): Promise<void>
  openCheckoutUrl(): Promise<void>
  waitForHostedDocument(): Promise<void>
  ensurePaymentMethodForm(): Promise<void>
  fillCardNumber(): Promise<void>
  fillCardExpiration(): Promise<void>
  fillCardCvc(): Promise<void>
  fillCardholderName(): Promise<void>
  fillPostalCode(): Promise<void>
  interactOptionalSaveControl(): Promise<void>
  interactAuxiliaryDisclosureControl(): Promise<void>
  ensurePaymentSubmissionActionable(): Promise<void>
  dispatchPaymentSubmission(): Promise<void>
  observeProviderDisposition(): Promise<'ACCEPTED' | 'REJECTED'>
  observeLocalReturnRedirect(): Promise<'NOT_OBSERVED' | 'OBSERVED'>
}

export async function runHostedCheckoutBrowserDiagnostic(
  actions: HostedCheckoutBrowserActions,
): Promise<HostedCheckoutBrowserDiagnostic> {
  let checkpoint: HostedCheckoutBrowserCheckpoint = 'BROWSER_LAUNCH'
  const observed: HostedCheckoutBrowserObservedState = {
    submission: 'NOT_ATTEMPTED',
    provider: 'NOT_OBSERVED',
    redirect: 'NOT_OBSERVED',
  }
  try {
    await actions.launchBrowser()
    checkpoint = 'CHECKOUT_URL_OPEN'
    await actions.openCheckoutUrl()
    checkpoint = 'HOSTED_DOCUMENT_LOAD'
    await actions.waitForHostedDocument()
    checkpoint = 'PAYMENT_METHOD_FORM'
    await actions.ensurePaymentMethodForm()
    checkpoint = 'CARD_NUMBER'
    await actions.fillCardNumber()
    checkpoint = 'CARD_EXPIRATION'
    await actions.fillCardExpiration()
    checkpoint = 'CARD_CVC'
    await actions.fillCardCvc()
    checkpoint = 'CARDHOLDER_NAME'
    await actions.fillCardholderName()
    checkpoint = 'POSTAL_CODE'
    await actions.fillPostalCode()
    checkpoint = 'OPTIONAL_SAVE_CONTROL'
    await actions.interactOptionalSaveControl()
    checkpoint = 'AUXILIARY_DISCLOSURE_CONTROL'
    await actions.interactAuxiliaryDisclosureControl()
    checkpoint = 'PAYMENT_SUBMISSION_ACTIONABILITY'
    await actions.ensurePaymentSubmissionActionable()
    checkpoint = 'PAYMENT_SUBMISSION_DISPATCH'
    await actions.dispatchPaymentSubmission()
    observed.submission = 'ATTEMPTED'
    checkpoint = 'PROVIDER_DISPOSITION'
    const provider = await actions.observeProviderDisposition()
    if (provider !== 'ACCEPTED' && provider !== 'REJECTED') {
      throw new Error('Hosted Checkout provider disposition invalid')
    }
    observed.provider = provider
    checkpoint = 'LOCAL_RETURN_REDIRECT'
    const redirect = await actions.observeLocalReturnRedirect()
    if (redirect !== 'NOT_OBSERVED' && redirect !== 'OBSERVED') {
      throw new Error('Hosted Checkout redirect observation invalid')
    }
    observed.redirect = redirect
    return createHostedCheckoutBrowserDiagnostic(checkpoint, undefined, observed)
  } catch (error) {
    throw toSafeHostedCheckoutBrowserError(error, checkpoint, observed)
  }
}

const checkoutCreationErrorCodes = new Set([
  'CHECKOUT_ALREADY_EXISTS',
  'CHECKOUT_DISABLED',
  'CHECKOUT_EXPIRED',
  'CHECKOUT_NOT_FOUND',
  'CHECKOUT_UNAVAILABLE',
  'CONNECT_ACTION_REQUIRED',
  'CONNECT_NOT_READY',
  'CORS_ORIGIN_DENIED',
  'EVENT_NOT_SELLABLE',
  'IDEMPOTENCY_CONFLICT',
  'INTERNAL_ERROR',
  'INVALID_REQUEST',
  'INVALID_STRIPE_SESSION',
  'METHOD_NOT_ALLOWED',
  'RATE_LIMITED',
  'STRIPE_REQUEST_FAILED',
  'TIER_NOT_ACTIVE',
  'TIER_NOT_FOUND',
  'TIER_SOLD_OUT',
])

export async function toSafeCheckoutCreationError(
  response: Response,
): Promise<Error> {
  let code = 'UNKNOWN'
  try {
    const value: unknown = await response.json()
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const error = Reflect.get(value, 'error')
      if (typeof error === 'object' && error !== null && !Array.isArray(error)) {
        const candidate = Reflect.get(error, 'code')
        if (typeof candidate === 'string' && checkoutCreationErrorCodes.has(candidate)) {
          code = candidate
        }
      }
    }
  } catch {
    // The fixed UNKNOWN label is the only fallback; response bodies never escape.
  }
  return new Error(`Checkout creation failed: HTTP ${response.status} ${code}`)
}

export type ConnectProof = {
  ok: boolean
  livemode: boolean
  applied_recipient: boolean
  dashboard: string
  fees_collector: string
  losses_collector: string
  transfers_status: string
  payouts_status: string
  requirements_status: string
  currently_due_count: number
  past_due_count: number
  persistence: string
}

export type OrderProof = {
  order_handle: 'paid' | 'declined'
  status: string
  subtotal_minor: number
  total_minor: number
  application_fee_amount_minor: number
  expected_organizer_proceeds_minor: number
  reconciliation_status: string
  failure_code: string | null
}

export type FixtureProof = {
  ok: boolean
  orders: OrderProof[]
  items: Array<{
    order_handle: 'paid' | 'declined'
    tier_label: 'ga' | 'vip'
    tier_name: string
    unit_amount_minor: number
    quantity: number
    subtotal_minor: number
    currency: string
  }>
  tickets: Array<{
    order_handle: 'paid' | 'declined'
    ticket_count: number
    unique_ticket_count: number
    valid_count: number
    refunded_count: number
    bindings_valid: boolean
    sequences_valid: boolean
    refunded_timestamps_valid: boolean
  }>
  refunds: Array<{
    order_handle: 'paid' | 'declined'
    status: string
    amount_minor: number
    reverse_transfer: boolean
    refund_application_fee: boolean
    transfer_reversal_amount_minor: number
    application_fee_refund_amount_minor: number
    policy_verified: boolean
    policy_failure_code: string | null
  }>
  receipts: Array<{
    event_type: string
    processing_status: string
    delivery_attempt_count: number
    error_code: string | null
  }>
}

export type ReconciliationProof = {
  ok: boolean
  livemode: boolean
  order_status: string
  total_minor: number
  intent_amount: number
  charge_amount: number
  application_fee_expected: number
  application_fee_intent: number
  application_fee_actual: number
  organizer_proceeds_expected: number
  transfer_amount: number
  transfer_less_application_fee: number
  balance_transaction_amount: number
  balance_transaction_fee: number
  destination_charge: boolean
  cross_object_relations_match: boolean
  line_bindings_valid: boolean
  line_count: number
  admission_count: number
}

export type EventProof = {
  ok: boolean
  livemode: boolean
  matching_types: string[]
  has_more: boolean
}
