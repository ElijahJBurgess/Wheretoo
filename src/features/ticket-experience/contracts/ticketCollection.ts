export type TicketStatus = 'valid' | 'used' | 'refunded' | 'cancelled'

export type TicketDisplay = {
  selector: string
  eventId: string
  eventName: string
  startsAt: string | null
  endsAt: string | null
  eventFactsAvailable?: boolean
  eventUpdated?: boolean
  eventStatus?: 'published' | 'cancelled'
  timezone?: string
  venueName: string
  admissionLabel: string
  position: number
  totalInCollection: number
  attendeeLabel?: string
  usedAt?: string
  directionsUrl?: string
} & (
  | { status: 'valid'; admissionCredential: string }
  | { status: Exclude<TicketStatus, 'valid'>; admissionCredential: null }
)

export type TicketCollection = {
  registrationId?: string
  registrationStatus?: 'confirmed' | 'cancelled'
  collectionLabel: string
  eventId: string
  tickets: readonly TicketDisplay[]
}

export type TicketCollectionResult =
  | { kind: 'ready'; collection: TicketCollection }
  | { kind: 'empty'; eventId: string }
  | { kind: 'unavailable' }
  | { kind: 'not_enabled' }

export interface TicketCollectionReader {
  readCollection(input: {
    collectionBearer: string
    signal?: AbortSignal
  }): Promise<TicketCollectionResult>
}
