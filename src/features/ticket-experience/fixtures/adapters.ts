import type { AdmissionChecker } from '../contracts/admission'
import type { EventDashboardReader } from '../contracts/dashboard'
import type { TicketCollectionReader } from '../contracts/ticketCollection'
import type { WalletProvider } from '../contracts/wallet'
import { admissionScenarios, dashboardScenarios, ticketCollectionScenarios } from './scenarios'

function throwIfAborted(signal?: AbortSignal) {
  signal?.throwIfAborted()
}

export const fixtureTicketCollectionReader: TicketCollectionReader = {
  async readCollection({ collectionBearer, signal }) {
    throwIfAborted(signal)
    return ticketCollectionScenarios[collectionBearer] ?? { kind: 'unavailable' }
  },
}

export const fixtureAdmissionChecker: AdmissionChecker = {
  async checkAdmission({ eventId, credential, signal }) {
    throwIfAborted(signal)
    const scenario = admissionScenarios[credential]

    if (!scenario) return { outcome: 'invalid' }
    if (scenario.eventId !== eventId) return { outcome: 'wrong_event' }
    return scenario.result
  },
}

export const fixtureEventDashboardReader: EventDashboardReader = {
  async readDashboard({ eventId, signal }) {
    throwIfAborted(signal)
    return dashboardScenarios[eventId] ?? { kind: 'unavailable' }
  },
}

export const fixtureWalletProvider: WalletProvider = {
  getCapability() {
    return { kind: 'unavailable', label: 'Add to Wallet — Coming later' }
  },
}
