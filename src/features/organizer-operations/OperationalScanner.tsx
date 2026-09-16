import { useMemo, useState } from 'react'
import type { AdmissionCheckResult } from '../ticket-experience/contracts/admission'
import { AdmissionResultView } from '../ticket-experience/scanner/OrganizerScannerView'
import { EventArtwork } from './EventArtwork'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { ScannerContent } from '../ticket-experience/scanner/OrganizerScannerPage'
import type { OrganizerScannerPageProps } from '../ticket-experience/scanner/useScannerController'
import { operationsKeys, useOperationsMetrics } from './operations.queries'
import { isOperationsAccessDenied } from './operations.errors'
import { OperationsError } from './OperationsUi'
import type { CheckInContext } from './CheckInContext'
import { isFreeEventAdmissionOpen } from './freeOperations.schemas'
import type { EventMetrics } from './operations.schemas'
export function OperationalScanner({ admissionChecker, cameraDecoder }: OrganizerScannerPageProps) {
  const { eventId = '' } = useParams()
  const context = useOutletContext<CheckInContext | null>()
  const session = useSession()
  const ownerId = session.status === 'authenticated' ? session.user.id : ''
  if (!ownerId) return <p role='alert'>Check-in unavailable</p>
  const sourceKind = context?.sourceKind ?? 'paid_order'
  const identityVersion = context?.identityVersion ?? session.identityVersion ?? 0
  return <ScopedOperationalScanner key={`${ownerId}:${identityVersion}:${eventId}:${sourceKind}`} ownerId={ownerId} identityVersion={identityVersion} eventId={eventId} sourceKind={sourceKind} event={context?.event} admissionChecker={admissionChecker} cameraDecoder={cameraDecoder} />
}

function ScopedOperationalScanner({ ownerId, identityVersion, eventId, sourceKind, event, admissionChecker, cameraDecoder }: OrganizerScannerPageProps & Pick<CheckInContext, 'ownerId' | 'identityVersion' | 'eventId' | 'sourceKind'> & { event?: CheckInContext['event'] }) {
  const metrics = useOperationsMetrics(ownerId, eventId, sourceKind, identityVersion)
  const [lastResult, setLastResult] = useState<{ ownerId: string; eventId: string; value: AdmissionCheckResult } | null>(null)
  const client = useQueryClient()
  const checker = useMemo(
    () => ({
      async checkAdmission(input: Parameters<typeof admissionChecker.checkAdmission>[0]) {
        setLastResult(null)
        const result = await admissionChecker.checkAdmission(input)
        if (input.signal?.aborted) return result
        setLastResult({ ownerId, eventId, value: result })
        void client.invalidateQueries({ queryKey: operationsKeys.event(ownerId, eventId) })
        return result
      },
    }),
    [admissionChecker, client, ownerId, eventId],
  )
  if (metrics.isPending) return <p role='status'>Loading check-in…</p>
  if (!metrics.data || isOperationsAccessDenied(metrics.error)) {
    return (
      <OperationsError
        title='Check-in unavailable'
        retry={() => void metrics.refetch()}
      />
    )
  }
  const paid = sourceKind === 'paid_order' ? metrics.data as EventMetrics : null
  const admissionEligible = sourceKind === 'free_registration' && event
    ? isFreeEventAdmissionOpen(event)
    : paid?.admissionEligible ?? false
  const title = event?.title ?? paid?.event.title ?? 'Untitled event'
  const artwork = event?.artwork_path ?? paid?.event.artworkPath ?? null
  return (
    <section className='ops-scanner'>
      <Link className='ops-back' to={`/organizer/events/${eventId}/dashboard`}>← Dashboard</Link>
      {metrics.isError && <p role='status'>Check-in totals could not refresh. Your ticket result remains below. <button type='button' onClick={() => void metrics.refetch()}>Refresh totals</button></p>}
      <header className='ops-scanner__event'>
        <EventArtwork source={artwork} className='ops-scanner__art' eager />
        <h1>{title || 'Untitled event'}</h1>
        <p>{metrics.data.checkedIn} / {metrics.data.issued} checked in</p>
      </header>
      {admissionEligible
        ? (
          <ScannerContent
            key={`${ownerId}:${eventId}`}
            admissionChecker={checker}
            cameraDecoder={cameraDecoder}
            onReset={() => setLastResult(null)}
          />
        )
        : (
          <div className='operations-state'>
            {lastResult?.ownerId === ownerId && lastResult.eventId === eventId && <AdmissionResultView result={lastResult.value}><Link className='ops-button' to={`/organizer/events/${eventId}/dashboard`}>Event dashboard</Link></AdmissionResultView>}
            <h2>Check-in closed</h2>
            <p>Event history remains available.</p>
          </div>
        )}
      <Link className='ops-button' to={`/organizer/events/${eventId}/check-in/find`}>Find guest</Link>
    </section>
  )
}
