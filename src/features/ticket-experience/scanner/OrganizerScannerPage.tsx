import { OperationalScanner } from '../../organizer-operations/OperationalScanner'
import { useState } from 'react'
import { OrganizerScannerView } from './OrganizerScannerView'
import { useScannerController, type OrganizerScannerPageProps } from './useScannerController'

export function OrganizerScannerPage(props: OrganizerScannerPageProps) {
  if (props.operational) return <OperationalScanner {...props} />
  return <ScannerContent {...props} />
}

export function ScannerContent(props: OrganizerScannerPageProps) {
  const controller = useScannerController(props)
  const [muted, setMuted] = useState(false)

  return (
    <OrganizerScannerView
      controller={controller}
      muted={muted}
      onToggleMute={() => setMuted((value) => !value)}
    />
  )
}
