import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { useReportPublicEvent } from './moderation.queries'
import type { ReportReason } from './moderation.types'

const reportReasons: ReadonlyArray<{ label: string; value: ReportReason }> = [
  { label: 'Scam or misleading', value: 'scam_misleading' },
  { label: 'Unsafe', value: 'unsafe' },
  { label: 'Prohibited content', value: 'prohibited_content' },
  { label: 'Wrong location', value: 'wrong_location' },
  { label: 'Event does not exist', value: 'event_missing' },
  { label: 'Adult content is misrepresented', value: 'adult_misrepresented' },
  { label: 'Hate or extremism', value: 'hate_extremism' },
  { label: 'Other', value: 'other' },
]

type ReportEventDialogProps = {
  eventId: string
}

function closeNativeDialog(dialog: HTMLDialogElement) {
  if (typeof dialog.close === 'function' && dialog.open) {
    dialog.close()
    return
  }
  dialog.removeAttribute('open')
}

export function ReportEventDialog({ eventId }: ReportEventDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const submittingRef = useRef(false)
  const titleId = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason | ''>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const reportMutation = useReportPublicEvent(eventId)

  useEffect(() => {
    if (!isOpen) return
    const dialog = dialogRef.current
    if (!dialog) return
    const trigger = triggerRef.current

    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    dialog.querySelector<HTMLInputElement>('input[type="radio"]')?.focus()

    return () => {
      closeNativeDialog(dialog)
      trigger?.focus()
    }
  }, [isOpen])

  function openDialog() {
    reportMutation.reset()
    setReason('')
    setErrorMessage(null)
    setSuccessMessage(null)
    setIsOpen(true)
  }

  function closeDialog() {
    if (submittingRef.current) return
    setReason('')
    setErrorMessage(null)
    setIsOpen(false)
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    closeDialog()
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason === '' || submittingRef.current) return

    submittingRef.current = true
    setIsSubmitting(true)
    setErrorMessage(null)
    try {
      await reportMutation.mutateAsync(reason)
      reportMutation.reset()
      setReason('')
      setSuccessMessage('Report received. Thank you for letting us know.')
      setIsOpen(false)
    } catch {
      setErrorMessage('We could not send this report. The event may no longer be available. Try again.')
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="report-event">
      <Button className="report-event__trigger" onClick={openDialog} ref={triggerRef} variant="secondary">
        Report this event
      </Button>
      {successMessage ? <p className="report-event__success" role="status">{successMessage}</p> : null}
      {isOpen ? (
        <dialog
          aria-labelledby={titleId}
          className="report-event-dialog"
          onCancel={(event) => {
            event.preventDefault()
            closeDialog()
          }}
          onKeyDown={handleDialogKeyDown}
          ref={dialogRef}
        >
          <form className="report-event-dialog__panel" onSubmit={(event) => void submitReport(event)}>
            <div>
              <p className="public-event__eyebrow">Community report</p>
              <h2 id={titleId}>Report this event</h2>
              <p>Choose the one reason that best describes the issue.</p>
            </div>
            <fieldset className="report-event-dialog__reasons">
              <legend>Why are you reporting this event?</legend>
              <div>
                {reportReasons.map((option) => (
                  <label key={option.value}>
                    <input
                      checked={reason === option.value}
                      disabled={isSubmitting}
                      name="report-reason"
                      onChange={() => setReason(option.value)}
                      type="radio"
                      value={option.value}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {errorMessage ? <p className="report-event-dialog__error" role="alert">{errorMessage}</p> : null}
            <div className="report-event-dialog__actions">
              <Button disabled={isSubmitting} onClick={closeDialog} variant="secondary">Cancel</Button>
              <Button disabled={reason === '' || isSubmitting} type="submit">
                {isSubmitting ? 'Sending report…' : 'Send report'}
              </Button>
            </div>
          </form>
        </dialog>
      ) : null}
    </div>
  )
}
