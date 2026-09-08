import { useState } from 'react'
import { createAdmissionChecker } from '../adapters/admissionChecker'
import { OrganizerScannerPage } from '../scanner/OrganizerScannerPage'
import { createCameraDecoder } from '../scanner/cameraDecoder'

const admissionChecker = createAdmissionChecker()

export default function ProductionOrganizerScannerRoute() {
  const [cameraDecoder] = useState(createCameraDecoder)
  return <OrganizerScannerPage admissionChecker={admissionChecker} cameraDecoder={cameraDecoder} />
}
