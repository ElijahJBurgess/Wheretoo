export type PublicTicketingErrorCode = 'RETRYABLE' | 'INVALID_RESPONSE'

export class PublicTicketingError extends Error {
  constructor(readonly code: PublicTicketingErrorCode) {
    super('Public event details are unavailable')
    this.name = 'PublicTicketingError'
  }
}

export function isRetryablePublicTicketingError(error: unknown): error is PublicTicketingError {
  return error instanceof PublicTicketingError && error.code === 'RETRYABLE'
}
