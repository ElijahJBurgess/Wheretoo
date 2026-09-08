import type { AdmissionCheckResult } from '../contracts/admission'
import type { EventDashboardResult } from '../contracts/dashboard'
import type { TicketCollection, TicketCollectionResult, TicketDisplay } from '../contracts/ticketCollection'

const eventDetails = {
  eventId: 'event-a',
  eventName: 'Mission Night Market',
  startsAt: '2026-09-12T18:00:00-07:00',
  endsAt: '2026-09-12T22:00:00-07:00',
  venueName: 'Valencia Street Commons',
  attendeeLabel: 'Demo guest',
  directionsUrl: 'https://maps.example.invalid/mission-night-market',
} as const

function validTicket(input: {
  selector: string
  admissionLabel: string
  position: number
  totalInCollection: number
  admissionCredential: string
}): TicketDisplay {
  return {
    ...eventDetails,
    ...input,
    status: 'valid',
  }
}

function inactiveTicket(
  status: 'used' | 'refunded' | 'cancelled',
  selector: string,
): TicketDisplay {
  return {
    ...eventDetails,
    selector,
    admissionLabel: 'General Admission',
    position: 1,
    totalInCollection: 1,
    status,
    admissionCredential: null,
  }
}

function collection(collectionLabel: string, tickets: readonly TicketDisplay[]): TicketCollectionResult {
  const value: TicketCollection = {
    collectionLabel,
    eventId: eventDetails.eventId,
    tickets,
  }

  return { kind: 'ready', collection: value }
}

export const ticketCollectionScenarios: Readonly<Record<string, TicketCollectionResult>> = {
  wh_test_collection_paid: collection('Mission Night Market tickets', [
    validTicket({
      selector: 'paid-1',
      admissionLabel: 'General Admission',
      position: 1,
      totalInCollection: 1,
      admissionCredential: 'wh_test_admit_paid_valid',
    }),
  ]),
  wh_test_collection_rsvp: collection('Mission Night Market admissions', [
    validTicket({
      selector: 'rsvp-1',
      admissionLabel: 'Free RSVP',
      position: 1,
      totalInCollection: 1,
      admissionCredential: 'wh_test_admit_rsvp_valid',
    }),
  ]),
  wh_test_collection_paid_multi: collection('Mission Night Market tickets', [
    validTicket({
      selector: 'paid-multi-1',
      admissionLabel: 'General Admission',
      position: 1,
      totalInCollection: 2,
      admissionCredential: 'wh_test_admit_paid_multi_1',
    }),
    validTicket({
      selector: 'paid-multi-2',
      admissionLabel: 'General Admission',
      position: 2,
      totalInCollection: 2,
      admissionCredential: 'wh_test_admit_paid_multi_2',
    }),
  ]),
  wh_test_collection_used: collection('Mission Night Market ticket', [
    inactiveTicket('used', 'used-1'),
  ]),
  wh_test_collection_refunded: collection('Mission Night Market ticket', [
    inactiveTicket('refunded', 'refunded-1'),
  ]),
  wh_test_collection_cancelled: collection('Mission Night Market ticket', [
    inactiveTicket('cancelled', 'cancelled-1'),
  ]),
  wh_test_collection_ended: collection('Mission Night Market ticket', [
    {
      ...validTicket({
        selector: 'ended-1',
        admissionLabel: 'General Admission',
        position: 1,
        totalInCollection: 1,
        admissionCredential: 'wh_test_admit_ended',
      }),
      startsAt: '2026-08-12T18:00:00-07:00',
      endsAt: '2026-08-12T22:00:00-07:00',
    },
  ]),
  wh_test_collection_empty: { kind: 'empty', eventId: eventDetails.eventId },
  wh_test_collection_unavailable: { kind: 'unavailable' },
  wh_test_collection_not_enabled: { kind: 'not_enabled' },
}

export type AdmissionScenario = {
  eventId: string
  result: AdmissionCheckResult
}

export const admissionScenarios: Readonly<Record<string, AdmissionScenario>> = {
  wh_test_admit_paid_valid: {
    eventId: eventDetails.eventId,
    result: {
      outcome: 'admitted',
      admissionLabel: 'General Admission',
      attendeeLabel: eventDetails.attendeeLabel,
    },
  },
  wh_test_admit_rsvp_valid: {
    eventId: eventDetails.eventId,
    result: {
      outcome: 'admitted',
      admissionLabel: 'Free RSVP',
      attendeeLabel: eventDetails.attendeeLabel,
    },
  },
  wh_test_admit_paid_multi_1: {
    eventId: eventDetails.eventId,
    result: {
      outcome: 'admitted',
      admissionLabel: 'General Admission',
      attendeeLabel: eventDetails.attendeeLabel,
    },
  },
  wh_test_admit_paid_multi_2: {
    eventId: eventDetails.eventId,
    result: {
      outcome: 'admitted',
      admissionLabel: 'General Admission',
      attendeeLabel: eventDetails.attendeeLabel,
    },
  },
  wh_test_admit_already_used: {
    eventId: eventDetails.eventId,
    result: {
      outcome: 'already_used',
      admissionLabel: 'General Admission',
      attendeeLabel: eventDetails.attendeeLabel,
    },
  },
  wh_test_admit_refunded: {
    eventId: eventDetails.eventId,
    result: { outcome: 'refunded', admissionLabel: 'General Admission' },
  },
  wh_test_admit_cancelled: {
    eventId: eventDetails.eventId,
    result: { outcome: 'cancelled', admissionLabel: 'General Admission' },
  },
  wh_test_admit_invalid: {
    eventId: eventDetails.eventId,
    result: { outcome: 'invalid' },
  },
  wh_test_admit_network_error: {
    eventId: eventDetails.eventId,
    result: { outcome: 'network_error' },
  },
}

export const dashboardScenarios: Readonly<Record<string, EventDashboardResult>> = {
  'event-a': {
    kind: 'ready',
    dashboard: {
      eventId: eventDetails.eventId,
      eventName: eventDetails.eventName,
      eventStatus: 'Upcoming',
      startsAt: eventDetails.startsAt,
      ticketUnitsSold: 12,
      checkedIn: 4,
      remaining: 8,
      grossSales: { amountMinor: 48000, currency: 'USD' },
      dataDisclosure: 'Demo data',
      manageEventPath: `/organizer/events/${eventDetails.eventId}`,
    },
  },
  'event-unavailable': { kind: 'unavailable' },
  'event-not-enabled': { kind: 'not_enabled' },
}
