/* eslint-disable react-refresh/only-export-components */
import { AsyncState } from '../../../components/ui/AsyncState'
import { lazy, Suspense } from 'react'
import type { TicketExperienceRuntime } from './runtime.types'

const CollectionRoute = lazy(() => import('./ProductionTicketCollectionRoute'))
const DashboardRoute = lazy(() => import('../../organizer-operations/OrganizerDashboardPage').then(module => ({ default: module.OrganizerDashboardPage })))
const ScannerRoute = lazy(() => import('./ProductionOrganizerScannerRoute'))

export function NotEnabledRoute() {
  return <AsyncState status="unavailable" title="Ticket experience not enabled" />
}

function ProductionTicketCollectionRoute() {
  return <Suspense fallback={<AsyncState status="loading" title="Loading tickets" />}><CollectionRoute /></Suspense>
}

function ProductionOrganizerScannerRoute() {
  return <Suspense fallback={<AsyncState status="loading" title="Loading scanner" />}><ScannerRoute /></Suspense>
}

export const productionTicketExperienceRuntime: TicketExperienceRuntime = {
  TicketCollectionRoute: ProductionTicketCollectionRoute,
  OrganizerScannerRoute: ProductionOrganizerScannerRoute,
  OrganizerDashboardRoute: () => <Suspense fallback={<AsyncState status="loading" title="Loading event dashboard" />}><DashboardRoute /></Suspense>,
  developmentRoutes: [],
}
