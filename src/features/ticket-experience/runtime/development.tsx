/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AsyncState } from '../../../components/ui/AsyncState'
import type { AdmissionChecker, AdmissionCheckResult } from '../contracts/admission'
import type { TicketCollectionReader } from '../contracts/ticketCollection'
import { DevelopmentQrLabPage } from '../customer/DevelopmentQrLabPage'
import { TicketCollectionPage } from '../customer/TicketCollectionPage'
import { EventDashboardPage } from '../dashboard/EventDashboardPage'
import { EmailPreviewPage } from '../email/EmailPreviewPage'
import { emailPreviewScenarios } from '../email/emailPreviewScenarios'
import {
  fixtureAdmissionChecker,
  fixtureEventDashboardReader,
  fixtureTicketCollectionReader,
  fixtureWalletProvider,
} from '../fixtures/adapters'
import { dashboardScenarios, ticketCollectionScenarios } from '../fixtures/scenarios'
import { createCameraDecoder } from '../scanner/cameraDecoder'
import { DevelopmentScannerPage } from '../scanner/DevelopmentScannerPage'
import type { CameraDecoder, CameraStartResult } from '../scanner/scannerMachine'
import { productionTicketExperienceRuntime } from './production'
import type { TicketExperienceRuntime } from './runtime.types'

const developmentCameraDecoder = createCameraDecoder()
const developmentNow = () => new Date('2026-09-03T12:00:00Z')
const developmentManualCameraDecoder: CameraDecoder = {
  async start() { return { kind: 'ready' } },
  stop() {},
}

const developmentTicketErrorReader: TicketCollectionReader = {
  async readCollection() { throw new Error('DEVELOPMENT_TICKET_READER_FAILURE') },
}

const developmentTicketLoadingReader: TicketCollectionReader = {
  readCollection() { return new Promise(() => {}) },
}

const fixedCameraResults = {
  ready: { kind: 'ready' },
  'permission-denied': { kind: 'permission_denied' },
  'no-camera': { kind: 'no_camera' },
  'initialization-failed': { kind: 'initialization_failed' },
} as const satisfies Readonly<Record<string, CameraStartResult>>

function cameraReturning(result: CameraStartResult): CameraDecoder {
  return {
    async start() { return result },
    stop() {},
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function hasOwnScenario<T extends object>(registry: T, key: string | undefined): key is keyof T & string {
  return typeof key === 'string' && Object.hasOwn(registry, key)
}

function DevelopmentTicketCollectionRoute() {
  const { collectionBearer } = useParams()

  if (collectionBearer === 'wh_test_collection_loading') {
    return <TicketCollectionPage now={developmentNow} reader={developmentTicketLoadingReader} walletProvider={fixtureWalletProvider} />
  }

  if (collectionBearer === 'wh_test_collection_error') {
    return <TicketCollectionPage now={developmentNow} reader={developmentTicketErrorReader} walletProvider={fixtureWalletProvider} />
  }

  if (!hasOwnScenario(ticketCollectionScenarios, collectionBearer)) {
    const ProductionTicketCollectionRoute = productionTicketExperienceRuntime.TicketCollectionRoute
    return <ProductionTicketCollectionRoute />
  }

  return (
    <TicketCollectionPage
      now={developmentNow}
      reader={fixtureTicketCollectionReader}
      walletProvider={fixtureWalletProvider}
    />
  )
}

function DevelopmentDashboardContent() {
  const { eventId } = useParams()

  if (!hasOwnScenario(dashboardScenarios, eventId)) {
    return <AsyncState status="error" title="Development scenario unavailable" />
  }

  return (
    <EventDashboardPage
      reader={fixtureEventDashboardReader}
      scannerPathForEvent={(id) => `/__dev/ticket-shells/events/${encodeURIComponent(id)}/check-in/ready`}
    />
  )
}

function DevelopmentStandaloneDashboardRoute() {
  return (
    <main className="organizer-layout__main">
      <DevelopmentDashboardContent />
    </main>
  )
}

function DevelopmentScannerRoute() {
  const { eventId } = useParams()

  if (!hasOwnScenario(dashboardScenarios, eventId)) {
    return <AsyncState status="error" title="Development scenario unavailable" />
  }

  return (
    <DevelopmentScannerPage
      admissionChecker={fixtureAdmissionChecker}
      cameraDecoder={developmentCameraDecoder}
    />
  )
}

function DevelopmentHeldInitializingScannerRoute() {
  const { eventId } = useParams()
  const [held] = useState(() => deferred<CameraStartResult>())
  const cameraDecoder = useMemo<CameraDecoder>(() => ({
    start: () => held.promise,
    stop() {},
  }), [held])

  if (!hasOwnScenario(dashboardScenarios, eventId)) {
    return <AsyncState status="error" title="Development scenario unavailable" />
  }

  return (
    <DevelopmentScannerPage
      admissionChecker={fixtureAdmissionChecker}
      cameraDecoder={cameraDecoder}
      scenarioControl={(
        <button onClick={() => held.resolve({ kind: 'ready' })} type="button">
          Release camera state
        </button>
      )}
    />
  )
}

function DevelopmentHeldCheckingScannerRoute() {
  const { eventId } = useParams()
  const [held] = useState(() => deferred<AdmissionCheckResult>())
  const admissionChecker = useMemo<AdmissionChecker>(() => ({
    checkAdmission: () => held.promise,
  }), [held])

  if (!hasOwnScenario(dashboardScenarios, eventId)) {
    return <AsyncState status="error" title="Development scenario unavailable" />
  }

  return (
    <DevelopmentScannerPage
      admissionChecker={admissionChecker}
      cameraDecoder={developmentManualCameraDecoder}
      scenarioControl={(
        <button onClick={() => held.resolve({ outcome: 'admitted' })} type="button">
          Release check result
        </button>
      )}
    />
  )
}

function DevelopmentScannerScenarioRoute() {
  const { eventId, scannerScenario } = useParams()

  if (!hasOwnScenario(dashboardScenarios, eventId)) {
    return <AsyncState status="error" title="Development scenario unavailable" />
  }
  if (scannerScenario === 'initializing') return <DevelopmentHeldInitializingScannerRoute />
  if (scannerScenario === 'checking') return <DevelopmentHeldCheckingScannerRoute />
  if (!hasOwnScenario(fixedCameraResults, scannerScenario)) {
    return <AsyncState status="error" title="Development scenario unavailable" />
  }

  return (
    <DevelopmentScannerPage
      admissionChecker={fixtureAdmissionChecker}
      cameraDecoder={cameraReturning(fixedCameraResults[scannerScenario])}
    />
  )
}

function DevelopmentEmailRoute() {
  const { scenario, template } = useParams()
  const scenarioKey = template && scenario ? `${template}/${scenario}` : undefined

  if (!hasOwnScenario(emailPreviewScenarios, scenarioKey)) {
    return <AsyncState status="error" title="Development scenario unavailable" />
  }

  return <EmailPreviewPage input={emailPreviewScenarios[scenarioKey]} />
}

export const developmentTicketExperienceRuntime: TicketExperienceRuntime = {
  TicketCollectionRoute: DevelopmentTicketCollectionRoute,
  OrganizerScannerRoute: productionTicketExperienceRuntime.OrganizerScannerRoute,
  OrganizerDashboardRoute: productionTicketExperienceRuntime.OrganizerDashboardRoute,
  developmentRoutes: [
    {
      path: '/__dev/ticket-shells/events/:eventId/dashboard',
      Component: DevelopmentStandaloneDashboardRoute,
    },
    {
      path: '/__dev/ticket-shells/events/:eventId/check-in',
      Component: DevelopmentScannerRoute,
    },
    {
      path: '/__dev/ticket-shells/events/:eventId/check-in/:scannerScenario',
      Component: DevelopmentScannerScenarioRoute,
    },
    {
      path: '/__dev/ticket-shells/emails/:template/:scenario',
      Component: DevelopmentEmailRoute,
    },
    {
      path: '/__dev/ticket-shells/qr/:caseId',
      Component: DevelopmentQrLabPage,
    },
  ],
}
