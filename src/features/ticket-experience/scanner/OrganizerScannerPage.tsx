import { useState } from 'react'
import { OrganizerScannerView } from './OrganizerScannerView'
import { useScannerController, type OrganizerScannerPageProps } from './useScannerController'

export function OrganizerScannerPage(props: OrganizerScannerPageProps) {
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
