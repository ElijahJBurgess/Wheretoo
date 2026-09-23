import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '../auth/SessionProvider'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { useEventCoverState } from './eventImages.queries'
import { removeEventFlyer, replaceEventFlyer } from './eventFlyer.api'
import { validateImageSelection } from './imageFiles'
import { AiCoverChooser } from './AiCoverChooser'
import './event-images.css'

type ImageManagerProps = {
  eventId: string
  disabled?: boolean
  ensureEventId?: () => Promise<string>
  onBusyChange?: (busy: boolean) => void
  onUploadSettled?: (eventId: string, error: string | null) => void
}
export function EventImageManager(props: ImageManagerProps) {
  const session = useSession()
  return <ImageManager key={`${props.eventId}:${session.user?.id ?? 'none'}:${session.identityVersion}`} {...props} />
}
function ImageManager({ eventId, disabled = false, ensureEventId, onBusyChange, onUploadSettled }: ImageManagerProps) {
  const images = useEventCoverState(eventId)
  const session = useSession()
  const client = useQueryClient()
  const [previews, setPreviews] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const records = images.data?.images ?? []
  const revision = eventId ? images.data?.revision : 0
  const unavailable = disabled || busy || (!!eventId && (images.isPending || images.isError)) || session.status !== 'authenticated'
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (lock.current || unavailable) return
    lock.current = true
    const identityCurrent = captureIdentityLifetime(client, session.user?.id ?? null)
    const current = () => mounted.current && identityCurrent()
    setBusy(true); setError(null); onBusyChange?.(true)
    try { await action(current) } catch (e) { if (current()) setError(e instanceof Error ? e.message : 'Your flyer could not be saved.') }
    finally {
      if (current()) { await Promise.all([client.invalidateQueries({ queryKey: ['event-images'] }), client.invalidateQueries({ queryKey: ['public-event-images'] })]); if (current()) { setBusy(false); setPreviews([]); onBusyChange?.(false) } }
      lock.current = false
    }
  }
  function upload(files: File[]) {
    if (!files.length) return
    let savedId = eventId
    let failure: string | null = null
    let remainsCurrent = () => false
    void run(async current => {
      remainsCurrent = current
      try {
        if (files.length !== 1) throw new Error('Choose one flyer at a time.')
        validateImageSelection(files, 0)
        const pending = await Promise.all(files.map(file => new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error('This image could not be read.'))
          reader.readAsDataURL(file)
        })))
        if (!current()) return
        setPreviews(pending)
        if (!savedId) savedId = await ensureEventId?.() ?? ''
        if (!current()) return
        if (!savedId) throw new Error('Your draft could not be saved. Try again.')
        await replaceEventFlyer(savedId, files[0], current, revision ?? -1)
      } catch (e) {
        failure = e instanceof Error ? e.message : 'Your flyer could not be saved.'
        throw e
      }
    }).then(() => {
      // Finish against the saved draft even if an upload is uncertain. Never
      // make a second draft just because an image response was lost.
      if (savedId && remainsCurrent()) onUploadSettled?.(savedId, failure)
    })
  }
  const flyer = records.find(image => image.position === 1)
  const uploadLabel = flyer ? 'Replace flyer' : 'Upload flyer'
  return <section className="event-image-manager" aria-label="Event flyer">
    <header className="event-image-heading"><h2>Event flyer <span>Optional</span></h2></header>
    <p className="event-image-status">Your event’s cover, from discovery to tickets.</p>
    <p className="event-image-status">4:5 portrait recommended. Other sizes fit inside the frame without cropping.</p>
    {previews.length || flyer ? <div className="event-flyer-preview">
      <img src={previews[0] ?? flyer?.url} alt={previews.length ? 'Uploading flyer' : 'Event flyer'} />
      {previews.length ? <span role="status">Saving…</span> : null}
    </div> : null}
    <div className={`event-image-dropzone${dragging ? ' event-image-dropzone--active' : ''}${flyer ? ' event-image-dropzone--compact' : ''}`}
      onDragOver={event => { event.preventDefault(); if (!unavailable) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); if (!unavailable) upload(Array.from(event.dataTransfer.files)) }}>
      <svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><rect x="4" y="6" width="24" height="20" rx="4" stroke="currentColor" strokeWidth="1.5"/><circle cx="11" cy="12" r="2" fill="currentColor"/><path d="m6 23 7-7 4 4 5-6 5 9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
      <label className="event-image-upload">
        <strong>{uploadLabel}</strong>
        <input aria-label={uploadLabel} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={unavailable}
          onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; upload(files) }} />
      </label>
      <p>or drag and drop here</p>
      <small>JPEG, PNG or WebP · 5 MB maximum</small>
    </div>
    {!!eventId && images.isPending ? <p role="status">Loading flyer…</p> : null}
    {!!eventId && images.isError ? <p role="alert">Your flyer could not load. <button type="button" onClick={() => void images.refetch()}>Refresh flyer</button></p> : null}
    <p className="event-image-status" aria-live="polite">{busy ? 'Saving flyer…' : flyer ? 'Your flyer saves automatically.' : 'Upload now, or come back to it later.'}</p>
    {error ? <p role="alert">{error} {eventId ? <button type="button" disabled={busy} onClick={() => void images.refetch()}>Refresh flyer</button> : null}</p> : null}
    {flyer ? <div className="event-image-actions"><button type="button" disabled={unavailable} onClick={() => void run(async current => removeEventFlyer(eventId, current, revision ?? -1))}>Remove flyer</button></div> : null}
    <AiCoverChooser eventId={eventId} revision={revision} latestGenerationId={images.data?.latestGenerationId} disabled={unavailable} />
  </section>
}
