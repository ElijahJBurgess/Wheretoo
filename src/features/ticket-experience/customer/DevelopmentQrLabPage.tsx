import { useParams } from 'react-router-dom'
import { AsyncState } from '../../../components/ui/AsyncState'
import { qrCases, type QrCaseId } from '../fixtures/qrCases'
import { AdmissionQr } from './AdmissionQr'

function isQrCaseId(value: string | undefined): value is QrCaseId {
  return typeof value === 'string' && Object.hasOwn(qrCases, value)
}

export function DevelopmentQrLabPage() {
  const { caseId } = useParams()

  if (!isQrCaseId(caseId)) {
    return (
      <main className="ticket-page ticket-page--state">
        <AsyncState status="error" title="QR case not found" />
      </main>
    )
  }

  return (
    <main className="ticket-page ticket-qr-lab">
      <AdmissionQr credential={qrCases[caseId].credential} />
    </main>
  )
}
