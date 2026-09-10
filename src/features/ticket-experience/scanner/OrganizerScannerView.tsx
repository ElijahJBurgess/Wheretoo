/* eslint-disable react-hooks/refs -- the controller intentionally groups reactive state with an opaque video RefObject */
import { dateTime } from '../../organizer-operations/operations.format'
import { useEffect, type ReactNode } from 'react'
import type { AdmissionOutcome } from '../contracts/admission'
import type { ScannerController } from './useScannerController'

export type OrganizerScannerViewProps = {
  controller: ScannerController
  muted: boolean
  onToggleMute(): void
  developmentControl?: ReactNode
}

const resultPresentation: Record<AdmissionOutcome, {
  icon: string
  title: string
  detail: string
  tone: 'success' | 'warning' | 'danger' | 'offline'
}> = {
  admitted: {
    icon: '✓',
    title: 'Admitted',
    detail: 'This guest is cleared to enter.',
    tone: 'success',
  },
  already_used: {
    icon: '↺',
    title: 'Already used',
    detail: 'This admission was checked in previously.',
    tone: 'warning',
  },
  refunded: {
    icon: '↺',
    title: 'Refunded',
    detail: 'Do not admit. This ticket was refunded.',
    tone: 'danger',
  },
  cancelled: {
    icon: '×',
    title: 'Cancelled',
    detail: 'Do not admit. This ticket was cancelled.',
    tone: 'danger',
  },
  wrong_event: {
    icon: '↗',
    title: 'Wrong event',
    detail: 'This admission belongs to a different event.',
    tone: 'danger',
  },
  invalid: {
    icon: '!',
    title: 'Invalid ticket',
    detail: 'This QR is not a valid admission for this event.',
    tone: 'danger',
  },
  network_error: {
    icon: '⌁',
    title: 'Network error',
    detail: 'Admission was not confirmed. Check the connection and retry.',
    tone: 'offline',
  },
}

function CameraRecovery({ controller }: { controller: ScannerController }) {
  const recovery = {
    permission_denied: {
      title: 'Camera permission denied',
      detail: 'Allow camera access in your browser settings, then try again.',
    },
    no_camera: {
      title: 'No camera available',
      detail: 'Connect or enable a camera, then try again.',
    },
    initialization_failed: {
      title: 'Camera could not start',
      detail: 'Close other camera apps and try again.',
    },
  } as const

  if (!(controller.state.kind in recovery)) return null
  const copy = recovery[controller.state.kind as keyof typeof recovery]

  return (
    <section className="organizer-scanner__center" role="alert">
      <span aria-hidden="true" className="organizer-scanner__state-icon">!</span>
      <h1>{copy.title}</h1>
      <p>{copy.detail}</p>
      <button className="ui-button organizer-scanner__button" onClick={controller.retryCamera} type="button">
        Retry camera
      </button>
    </section>
  )
}

function ScanResult({ controller }: { controller: ScannerController }) {
  if (controller.state.kind !== 'result') return null
  const { result } = controller.state
  const presentation = resultPresentation[result.outcome]

  return (
    <section
      aria-live="assertive"
      className={`organizer-scanner__result organizer-scanner__result--${result.outcome} organizer-scanner__result--${presentation.tone}`}
      role={result.outcome === 'admitted' ? 'status' : 'alert'}
    >
      <span aria-hidden="true" className="organizer-scanner__result-icon">{presentation.icon}</span>
      <p className="organizer-scanner__eyebrow">Admission result</p>
      <h1>{presentation.title}</h1>
      <p className="organizer-scanner__result-detail">{presentation.detail}</p>
      {result.admissionLabel || result.attendeeLabel ? (
        <dl className="organizer-scanner__context">
          {result.admissionLabel ? <div><dt>Admission</dt><dd>{result.admissionLabel}</dd></div> : null}
          {result.attendeeLabel ? <div><dt>Guest</dt><dd>{result.attendeeLabel}</dd></div> : null}
        </dl>
      ) : null}
      {result.usedAt && <p className="organizer-scanner__result-detail">{result.outcome === 'already_used' ? 'Previously admitted' : 'Checked in'} · {dateTime(result.usedAt)}</p>}
      <div className="organizer-scanner__actions">
        {result.outcome === 'network_error' ? (
          <>
            <button className="ui-button organizer-scanner__button" onClick={controller.retryCheck} type="button">
              Retry check-in
            </button>
            <button className="ui-button organizer-scanner__button organizer-scanner__button--quiet" onClick={controller.returnToScan} type="button">
              Return to scanning
            </button>
          </>
        ) : (
          <button className="ui-button organizer-scanner__button" onClick={controller.scanNext} type="button">
            Scan next ticket
          </button>
        )}
      </div>
    </section>
  )
}

export function OrganizerScannerView({
  controller,
  muted,
  onToggleMute,
  developmentControl,
}: OrganizerScannerViewProps) {
  const state = controller.state

  useEffect(() => {
    if (muted || state.kind !== 'result' || typeof navigator.vibrate !== 'function') return
    navigator.vibrate(state.result.outcome === 'admitted' ? 80 : [50, 45, 50])
  }, [muted, state])

  return (
    <section className={`organizer-scanner organizer-scanner--${state.kind}`}>
      <header className="organizer-scanner__header">
        <div>
          <p className="organizer-scanner__brand">Whereto</p>
          <p>Guest check-in</p>
        </div>
        <button
          aria-label={muted ? 'Unmute scanner feedback' : 'Mute scanner feedback'}
          className="organizer-scanner__mute"
          onClick={onToggleMute}
          type="button"
        >
          <span aria-hidden="true">{muted ? 'Muted' : 'Sound on'}</span>
        </button>
      </header>

      <video
        aria-label="Camera preview"
        className="organizer-scanner__video"
        hidden={state.kind !== 'initializing' && state.kind !== 'ready'}
        muted
        playsInline
        ref={controller.videoRef}
      />

      {state.kind === 'initializing' ? (
        <section className="organizer-scanner__center" role="status">
          <span aria-hidden="true" className="organizer-scanner__spinner" />
          <h1>Starting camera</h1>
          <p>Hold on while the scanner gets ready.</p>
        </section>
      ) : null}

      {state.kind === 'ready' ? (
        <section className="organizer-scanner__ready" role="status">
          <div aria-hidden="true" className="organizer-scanner__target" />
          <div className="organizer-scanner__ready-copy">
            <p className="organizer-scanner__eyebrow">Scanner ready</p>
            <h1>Ready to scan</h1>
            <p>Center one admission QR inside the frame.</p>
          </div>
        </section>
      ) : null}

      {state.kind === 'checking' ? (
        <section className="organizer-scanner__center" role="status">
          <span aria-hidden="true" className="organizer-scanner__spinner" />
          <h1>Checking ticket</h1>
          <p>Keep this screen open. Admission is not confirmed yet.</p>
        </section>
      ) : null}

      <CameraRecovery controller={controller} />
      <ScanResult controller={controller} />
      {developmentControl ? (
        <aside className="organizer-scanner__development" data-development-control>
          {developmentControl}
        </aside>
      ) : null}
    </section>
  )
}
