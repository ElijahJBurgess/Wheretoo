export type AdmissionOutcome =
  | 'admitted'
  | 'already_used'
  | 'refunded'
  | 'cancelled'
  | 'wrong_event'
  | 'invalid'
  | 'network_error'

export type AdmissionCheckResult = {
  outcome: AdmissionOutcome
  admissionLabel?: string
  attendeeLabel?: string
  usedAt?: string
}

export interface AdmissionChecker {
  checkAdmission(input: {
    eventId: string
    credential: string
    signal?: AbortSignal
  }): Promise<AdmissionCheckResult>
}
