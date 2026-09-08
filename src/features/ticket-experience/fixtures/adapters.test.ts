import {
  admissionCheckerContract,
  eventDashboardReaderContract,
  ticketCollectionReaderContract,
  walletProviderContract,
} from '../contracts/contractTests'
import {
  fixtureAdmissionChecker,
  fixtureEventDashboardReader,
  fixtureTicketCollectionReader,
  fixtureWalletProvider,
} from './adapters'

ticketCollectionReaderContract('fixture', () => fixtureTicketCollectionReader, {
  paidSingleBearer: 'wh_test_collection_paid',
  freeSingleBearer: 'wh_test_collection_rsvp',
  paidMultiBearer: 'wh_test_collection_paid_multi',
  inactiveBearers: {
    used: 'wh_test_collection_used',
    refunded: 'wh_test_collection_refunded',
    cancelled: 'wh_test_collection_cancelled',
  },
  emptyBearer: 'wh_test_collection_empty',
  unavailableBearer: 'wh_test_collection_unavailable',
  admissionCredentialAsBearer: 'wh_test_admit_paid_valid',
  checkoutBearerAsBearer: 'checkout_confirmation_foreign',
})

admissionCheckerContract('fixture', () => fixtureAdmissionChecker, {
  expected: [
    { eventId: 'event-a', credential: 'wh_test_admit_paid_valid', outcome: 'admitted' },
    { eventId: 'event-a', credential: 'wh_test_admit_rsvp_valid', outcome: 'admitted' },
    { eventId: 'event-a', credential: 'wh_test_admit_already_used', outcome: 'already_used' },
    { eventId: 'event-a', credential: 'wh_test_admit_refunded', outcome: 'refunded' },
    { eventId: 'event-a', credential: 'wh_test_admit_cancelled', outcome: 'cancelled' },
    { eventId: 'event-a', credential: 'wh_test_admit_invalid', outcome: 'invalid' },
    { eventId: 'event-a', credential: 'wh_test_admit_network_error', outcome: 'network_error' },
  ],
  paidValidCredential: 'wh_test_admit_paid_valid',
  freeValidCredential: 'wh_test_admit_rsvp_valid',
  collectionBearerAsCredential: 'wh_test_collection_paid',
  checkoutBearerAsCredential: 'checkout_confirmation_foreign',
})

eventDashboardReaderContract('fixture', () => fixtureEventDashboardReader, {
  readyEventId: 'event-a',
  unavailableEventId: 'event-unavailable',
  notEnabledEventId: 'event-not-enabled',
})

walletProviderContract('fixture', () => fixtureWalletProvider)
