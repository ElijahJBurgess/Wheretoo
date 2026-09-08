import { useEffect, useRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

type AdmissionQrProps = {
  credential: string
}

export function AdmissionQr({ credential }: AdmissionQrProps) {
  const qrContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = qrContainerRef.current?.querySelector('canvas')
    if (!canvas) return

    canvas.removeAttribute('data-qr-ready')
    const frame = window.requestAnimationFrame(() => {
      canvas.setAttribute('data-qr-ready', 'true')
    })

    return () => {
      window.cancelAnimationFrame(frame)
      canvas.removeAttribute('data-qr-ready')
    }
  }, [credential])

  return (
    <div ref={qrContainerRef} className="ticket-qr" data-testid="admission-qr">
      <QRCodeCanvas
        aria-label="Admission QR code"
        bgColor="#ffffff"
        boostLevel={false}
        fgColor="#000000"
        level="Q"
        marginSize={4}
        size={240}
        value={credential}
      />
    </div>
  )
}
