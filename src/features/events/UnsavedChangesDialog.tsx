import { useEffect, useRef } from 'react'
import { Button } from '../../components/ui/Button'

type UnsavedChangesDialogProps = {
  onLeave: () => void
  onStay: () => void
}

function closeDialog(dialog: HTMLDialogElement) {
  if (typeof dialog.close === 'function' && dialog.open) {
    dialog.close()
    return
  }

  dialog.removeAttribute('open')
}

export function UnsavedChangesDialog({ onLeave, onStay }: UnsavedChangesDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const isLeavingRef = useRef(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    if (typeof dialog.showModal === 'function') {
      dialog.showModal()
    } else {
      // Older test/browser environments still receive dialog semantics, but not modal behavior.
      dialog.setAttribute('open', '')
    }
    dialog.querySelector<HTMLButtonElement>('[data-stay-action]')?.focus()

    return () => {
      closeDialog(dialog)
      if (!isLeavingRef.current) previousFocusRef.current?.focus()
    }
  }, [])

  function stay() {
    const dialog = dialogRef.current
    if (dialog) closeDialog(dialog)
    previousFocusRef.current?.focus()
    onStay()
  }

  function leave() {
    isLeavingRef.current = true
    const dialog = dialogRef.current
    if (dialog) closeDialog(dialog)
    onLeave()
  }

  return (
    <dialog
      aria-labelledby="leave-draft-title"
      className="event-leave-dialog"
      onCancel={(event) => {
        event.preventDefault()
        stay()
      }}
      ref={dialogRef}
    >
      <div className="event-leave-dialog__panel">
        <p className="organizer-eyebrow">Unsaved draft</p>
        <h2 id="leave-draft-title">Leave without saving?</h2>
        <p>Your latest changes will be lost.</p>
        <div>
          <Button data-stay-action onClick={stay} variant="secondary">
            Stay
          </Button>
          <Button onClick={leave}>Leave</Button>
        </div>
      </div>
    </dialog>
  )
}
