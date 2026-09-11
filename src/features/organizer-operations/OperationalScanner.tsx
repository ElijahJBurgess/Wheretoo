import { useMemo, useState } from 'react'
import type { AdmissionCheckResult } from '../ticket-experience/contracts/admission'
import { AdmissionResultView } from '../ticket-experience/scanner/OrganizerScannerView'
import { EventArtwork } from './EventArtwork'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { ScannerContent } from '../ticket-experience/scanner/OrganizerScannerPage'
import type { OrganizerScannerPageProps } from '../ticket-experience/scanner/useScannerController'
import { operationsKeys, useEventMetrics } from './operations.queries'
import { OperationsError } from './OperationsUi'
export function OperationalScanner({ admissionChecker, cameraDecoder }: OrganizerScannerPageProps) {
  const { eventId = '' } = useParams()
  const session = useSession()
  const ownerId = session.status === 'authenticated' ? session.user.id : ''
  const metrics = useEventMetrics(ownerId, eventId)
  const [lastResult, setLastResult] = useState<{ ownerId: string; eventId: string; value: AdmissionCheckResult } | null>(null)
  const client = useQueryClient()
  const checker = useMemo(
    () => ({
      async checkAdmission(input: Parameters<typeof admissionChecker.checkAdmission>[0]) {
        setLastResult(null)
        const result = await admissionChecker.checkAdmission(input)
        setLastResult({ ownerId, eventId, value: result })
        void client.invalidateQueries({ queryKey: operationsKeys.event(ownerId, eventId) })
        return result
      },
    }),
    [admissionChecker, client, ownerId, eventId],
  )
  if (metrics.isPending) return <p role='status'>Loading check-in…</p>
  if (metrics.isError) {
    return (
      <OperationsError
        title='Check-in unavailable'
        retry={() => void metrics.refetch()}
      />
    )
  }
  return (
    <section className='ops-scanner'>
      <Link className='ops-back' to={`/organizer/events/${eventId}/dashboard`}>← Dashboard</Link>
      <header className='ops-scanner__event'>
        <EventArtwork source={metrics.data.event.artworkPath} className='ops-scanner__art' eager />
        <h1>{metrics.data.event.title || 'Untitled event'}</h1>
        <p>{metrics.data.checkedIn} / {metrics.data.issued} checked in</p>
      </header>
      {metrics.data.admissionEligible
        ? (
          <ScannerContent
            key={`${ownerId}:${eventId}`}
            admissionChecker={checker}
            cameraDecoder={cameraDecoder}
          />
        )
        : (
          <div className='operations-state'>
            {lastResult?.ownerId === ownerId && lastResult.eventId === eventId && <AdmissionResultView result={lastResult.value}><Link className='ops-button' to={`/organizer/events/${eventId}/dashboard`}>Event dashboard</Link></AdmissionResultView>}
            <h2>Check-in closed</h2>
            <p>Event history remains available.</p>
          </div>
        )}
      <Link className='ops-button' to={`/organizer/events/${eventId}/orders`}>Find guest</Link>
    </section>
  )
}
