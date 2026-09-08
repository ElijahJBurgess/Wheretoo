/* eslint-disable react-refresh/only-export-components */
import { AsyncState } from '../../../components/ui/AsyncState'
import { lazy, Suspense } from 'react'
import { createTicketCollectionReader } from '../adapters/ticketCollectionReader'
import type { WalletProvider } from '../contracts/wallet'
import { TicketCollectionPage } from '../customer/TicketCollectionPage'
import type { TicketExperienceRuntime } from './runtime.types'

const reader = createTicketCollectionReader()
const ScannerRoute = lazy(() => import('./ProductionOrganizerScannerRoute'))
const walletProvider: WalletProvider = {
  getCapability: () => ({ kind: 'unavailable', label: 'Add to Wallet — Coming later' }),
}

export function NotEnabledRoute() {
  return <AsyncState status="empty" title="Ticket experience not enabled" />
}

function ProductionTicketCollectionRoute() {
  return <TicketCollectionPage reader={reader} walletProvider={walletProvider} />
}

function ProductionOrganizerScannerRoute() {
  return <Suspense fallback={<AsyncState status="loading" title="Loading scanner" />}><ScannerRoute /></Suspense>
}

export const productionTicketExperienceRuntime: TicketExperienceRuntime = {
  TicketCollectionRoute: ProductionTicketCollectionRoute,
  OrganizerScannerRoute: ProductionOrganizerScannerRoute,
  OrganizerDashboardRoute: NotEnabledRoute,
  developmentRoutes: [],
}
