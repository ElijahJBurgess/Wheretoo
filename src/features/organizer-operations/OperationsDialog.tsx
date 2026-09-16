import { type PropsWithChildren, useEffect, useId, useRef } from 'react'
export function OperationsDialog(
  { title, busy, onClose, children, className = '' }: PropsWithChildren<
    { title: string; busy: boolean; className?: string; onClose(): void }
  >,
) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement
    if (dialog?.showModal) dialog.showModal()
    else dialog?.setAttribute('open', '')
    return () => {
      dialog?.close?.()
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])
  return (
    <dialog
      className={`ops-dialog ${className}`}
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  )
}
