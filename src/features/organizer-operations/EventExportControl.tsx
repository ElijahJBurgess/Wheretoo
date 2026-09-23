import { useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { getEventExport } from './export.api'
import { downloadExport, ExportError, exportFilename, serializeExport } from './export.csv'
import type { ExportKind } from './export.schemas'

type Props = { eventId: string; source: 'paid' | 'free'; eventStatus: string }
export function EventExportControl(props: Props) {
  const session = useSession()
  const location = useLocation()
  if (session.status !== 'authenticated' || props.eventStatus === 'draft') return null
  return <ExportControl key={`${session.user.id}:${session.identityVersion ?? 0}:${location.key}:${props.eventId}:${props.source}`}
    {...props} ownerId={session.user.id} />
}
function ExportControl({ eventId, source, ownerId }: Props & { ownerId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lastKind, setLastKind] = useState<ExportKind>('orders')
  const trigger = useRef<HTMLButtonElement>(null)
  const pending = useRef<AbortController | null>(null)
  const restoreFocus = useRef(false)
  useLayoutEffect(() => () => { pending.current?.abort(); pending.current = null }, [])

  useLayoutEffect(() => {
    if (!busy && restoreFocus.current) {
      restoreFocus.current = false
      trigger.current?.focus()
    }
  }, [busy])

  async function start(kind: ExportKind) {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    const currentIdentity = captureIdentityLifetime(queryClient, ownerId)
    const current = () => pending.current === controller && !controller.signal.aborted && currentIdentity()
    setLastKind(kind); setError(null); setMessage(''); setBusy(true)
    const timer = setTimeout(() => {
      if (pending.current !== controller) return
      controller.abort(); pending.current = null
      if (currentIdentity()) { setBusy(false); setError(new ExportError('unavailable').message) }
    }, 30_000)
    try {
      const data = await getEventExport(eventId, kind, controller.signal)
      if (!current()) return
      const csv = serializeExport(data)
      if (!current()) return
      downloadExport(csv, exportFilename(data))
      setMessage(data.rowCount ? 'Download started.' : 'No records yet.')
      setOpen(false)
      restoreFocus.current = true
    } catch (failure) {
      if (current()) setError(failure instanceof ExportError ? failure.message : new ExportError('unavailable').message)
    } finally {
      clearTimeout(timer)
      if (pending.current === controller) { pending.current = null; setBusy(false) }
    }
  }
  return <div className='ops-export'>
    {source === 'paid' ? <>
      <button className='ops-button' ref={trigger} type='button' aria-expanded={open} disabled={busy}
        onClick={() => setOpen(value => !value)}>Export</button>
      {open && <div className='ops-export__choices' aria-label='CSV export choices' onKeyDown={event => {
        if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
      }}>
        <button className='ops-button' type='button' disabled={busy} onClick={() => void start('orders')}>Orders CSV</button>
        <button className='ops-button' type='button' disabled={busy} onClick={() => void start('admissions')}>Admissions CSV</button>
      </div>}
    </> : <button className='ops-button' ref={trigger} type='button' disabled={busy} onClick={() => void start('registrations')}>Export Registrations CSV</button>}
    <p className='ops-note'>Exports all records for this event. Search and filters do not apply.</p>
    <p className='ops-note'>{source === 'paid' ? 'Admissions: one row per ticket. Contact details belong to the buyer.' : 'One row per admission. Contact details and registration quantity repeat for group RSVPs.'} Spreadsheet-sensitive text receives a protective apostrophe.</p>
    <p role='status' aria-live='polite'>{busy ? 'Preparing CSV…' : message}</p>
    {error && <div role='alert'><p>{error}</p><button className='ops-button' type='button' disabled={busy} onClick={() => void start(lastKind)}>Try again</button></div>}
  </div>
}
