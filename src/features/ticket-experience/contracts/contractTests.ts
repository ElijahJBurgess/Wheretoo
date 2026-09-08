import { describe, expect, it } from 'vitest'
import type { AdmissionChecker, AdmissionOutcome } from './admission'
import type { EventDashboardReader } from './dashboard'
import type { TicketCollectionReader, TicketDisplay, TicketStatus } from './ticketCollection'
import type { WalletProvider } from './wallet'

type TicketCollectionContractCases = {
  paidSingleBearer: string
  freeSingleBearer?: string
  eventId?: string
  optionalTicketFields?: readonly ('attendeeLabel' | 'directionsUrl')[]
  paidMultiBearer: string
  inactiveBearers: Record<Exclude<TicketStatus, 'valid'>, string>
  emptyBearer: string
  unavailableBearer: string
  admissionCredentialAsBearer: string
  checkoutBearerAsBearer?: string
}

type AdmissionContractCases = {
  expected: readonly {
    eventId: string
    credential: string
    outcome: AdmissionOutcome
  }[]
  paidValidCredential: string
  freeValidCredential?: string
  eventId?: string
  wrongEventId?: string
  optionalResultFields?: readonly 'attendeeLabel'[]
  malformedCredentialOutcome?: 'invalid' | 'network_error'
  collectionBearerAsCredential: string
  checkoutBearerAsCredential: string
}

const expectedTicketKeys = [
  'admissionCredential',
  'admissionLabel',
  'attendeeLabel',
  'directionsUrl',
  'endsAt',
  'eventId',
  'eventName',
  'position',
  'selector',
  'startsAt',
  'status',
  'totalInCollection',
  'venueName',
]

function expectSourceNeutralTicket(ticket: TicketDisplay, optionalFields: readonly string[]) {
  expect(Object.keys(ticket).sort()).toEqual(expectedTicketKeys.filter((key) => !['attendeeLabel', 'directionsUrl'].includes(key) || optionalFields.includes(key)))
  expect(ticket.admissionLabel).not.toHaveLength(0)
  expect(ticket).not.toHaveProperty('orderId')
  expect(ticket).not.toHaveProperty('payment')
  expect(ticket).not.toHaveProperty('rsvpId')
}

export function ticketCollectionReaderContract(
  name: string,
  makeReader: () => TicketCollectionReader,
  cases: TicketCollectionContractCases,
): void {
  describe(`${name} TicketCollectionReader contract`, () => {
    it.each([cases.paidSingleBearer, ...(cases.freeSingleBearer ? [cases.freeSingleBearer] : [])])(
      'returns one source-neutral ticket for %s',
      async (collectionBearer) => {
        const result = await makeReader().readCollection({ collectionBearer })

        expect(result.kind).toBe('ready')
        if (result.kind !== 'ready') throw new Error('Expected ready fixture')
        expect(result.collection.tickets).toHaveLength(1)
        expectSourceNeutralTicket(result.collection.tickets[0]!, cases.optionalTicketFields ?? ['attendeeLabel', 'directionsUrl'])
      },
    )

    it('keeps paid multi-ticket admissions as separate ticket objects', async () => {
      const result = await makeReader().readCollection({ collectionBearer: cases.paidMultiBearer })

      expect(result.kind).toBe('ready')
      if (result.kind !== 'ready') throw new Error('Expected ready fixture')
      expect(result.collection.tickets).toHaveLength(2)
      expect(result.collection.tickets[0]).not.toBe(result.collection.tickets[1])
      expect(result.collection.tickets.map(({ admissionLabel }) => admissionLabel)).toEqual([
        'General Admission',
        'General Admission',
      ])
      expect(result.collection.tickets.map(({ position }) => position)).toEqual([1, 2])
      expect(result.collection.tickets.map(({ totalInCollection }) => totalInCollection)).toEqual([2, 2])
    })

    it.each(Object.entries(cases.inactiveBearers) as [Exclude<TicketStatus, 'valid'>, string][])(
      'returns %s tickets without an admission credential',
      async (status, collectionBearer) => {
        const result = await makeReader().readCollection({ collectionBearer })

        expect(result.kind).toBe('ready')
        if (result.kind !== 'ready') throw new Error('Expected ready fixture')
        expect(result.collection.tickets).toHaveLength(1)
        expect(result.collection.tickets[0]).toMatchObject({ status, admissionCredential: null })
      },
    )

    it('returns a safe event identifier for an empty collection', async () => {
      const result = await makeReader().readCollection({ collectionBearer: cases.emptyBearer })

      expect(result.kind).toBe('empty')
      if (result.kind !== 'empty') throw new Error('Expected empty fixture')
      expect(Object.keys(result).sort()).toEqual(['eventId', 'kind'])
      expect(result.eventId).toBe(cases.eventId ?? 'event-a')
    })

    it('uses the same unavailable result for an unavailable or unknown bearer', async () => {
      const reader = makeReader()

      await expect(reader.readCollection({ collectionBearer: cases.unavailableBearer })).resolves.toEqual({
        kind: 'unavailable',
      })
      await expect(reader.readCollection({ collectionBearer: 'wh_test_collection_unknown' })).resolves.toEqual({
        kind: 'unavailable',
      })
    })

    it('rejects admission and Checkout credentials as collection bearers', async () => {
      const reader = makeReader()

      await expect(
        reader.readCollection({ collectionBearer: cases.admissionCredentialAsBearer }),
      ).resolves.toEqual({ kind: 'unavailable' })
      if (cases.checkoutBearerAsBearer) {
        await expect(reader.readCollection({ collectionBearer: cases.checkoutBearerAsBearer })).resolves.toEqual({ kind: 'unavailable' })
      }
    })

    it('honors an already-aborted collection read', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(
        makeReader().readCollection({
          collectionBearer: cases.paidSingleBearer,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' })
    })
  })
}

export function admissionCheckerContract(
  name: string,
  makeChecker: () => AdmissionChecker,
  cases: AdmissionContractCases,
): void {
  describe(`${name} AdmissionChecker contract`, () => {
    it.each(cases.expected)('returns $outcome for its deterministic admission credential', async (testCase) => {
      await expect(
        makeChecker().checkAdmission({ eventId: testCase.eventId, credential: testCase.credential }),
      ).resolves.toMatchObject({ outcome: testCase.outcome })
    })

    it.each([cases.paidValidCredential, ...(cases.freeValidCredential ? [cases.freeValidCredential] : [])])(
      'admits paid and free credentials through the same result shape',
      async (credential) => {
        const result = await makeChecker().checkAdmission({ eventId: cases.eventId ?? 'event-a', credential })

        expect(Object.keys(result).sort()).toEqual(['admissionLabel', ...(cases.optionalResultFields ?? ['attendeeLabel']), 'outcome'].sort())
        expect(result.outcome).toBe('admitted')
      },
    )

    it('rejects collection and Checkout bearers as admission credentials', async () => {
      const checker = makeChecker()

      await expect(
        checker.checkAdmission({ eventId: cases.eventId ?? 'event-a', credential: cases.collectionBearerAsCredential }),
      ).resolves.toEqual({ outcome: cases.malformedCredentialOutcome ?? 'invalid' })
      await expect(
        checker.checkAdmission({ eventId: cases.eventId ?? 'event-a', credential: cases.checkoutBearerAsCredential }),
      ).resolves.toEqual({ outcome: cases.malformedCredentialOutcome ?? 'invalid' })
    })

    it('rejects a valid credential presented for the wrong event', async () => {
      await expect(
        makeChecker().checkAdmission({ eventId: cases.wrongEventId ?? 'event-b', credential: cases.paidValidCredential }),
      ).resolves.toEqual({ outcome: 'wrong_event' })
    })

    it('honors an already-aborted admission check', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(
        makeChecker().checkAdmission({
          eventId: cases.eventId ?? 'event-a',
          credential: cases.paidValidCredential,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' })
    })
  })
}

export function eventDashboardReaderContract(
  name: string,
  makeReader: () => EventDashboardReader,
  cases: { readyEventId: string; unavailableEventId: string; notEnabledEventId: string },
): void {
  describe(`${name} EventDashboardReader contract`, () => {
    it('returns distinct, internally consistent event projections', async () => {
      const result = await makeReader().readDashboard({ eventId: cases.readyEventId })

      expect(result.kind).toBe('ready')
      if (result.kind !== 'ready') throw new Error('Expected ready dashboard')
      expect(result.dashboard.ticketUnitsSold).toBe(12)
      expect(result.dashboard.checkedIn).toBe(4)
      expect(result.dashboard.remaining).toBe(8)
      expect(result.dashboard.grossSales).toEqual({ amountMinor: 48000, currency: 'USD' })
      expect(result.dashboard.dataDisclosure).toBe('Demo data')
      expect(result.dashboard).not.toHaveProperty('orderCount')
    })

    it('distinguishes unavailable from not-enabled truth', async () => {
      const reader = makeReader()

      await expect(reader.readDashboard({ eventId: cases.unavailableEventId })).resolves.toEqual({
        kind: 'unavailable',
      })
      await expect(reader.readDashboard({ eventId: cases.notEnabledEventId })).resolves.toEqual({
        kind: 'not_enabled',
      })
    })

    it('honors an already-aborted dashboard read', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(
        makeReader().readDashboard({ eventId: cases.readyEventId, signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' })
    })
  })
}

export function walletProviderContract(name: string, makeProvider: () => WalletProvider): void {
  describe(`${name} WalletProvider contract`, () => {
    it('reports only the unavailable coming-later capability', () => {
      expect(makeProvider().getCapability()).toEqual({
        kind: 'unavailable',
        label: 'Add to Wallet — Coming later',
      })
    })
  })
}
