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
  collapsed?: boolean
  initialAiOpen?: boolean
  onPrepareAi?: () => Promise<string>
}
export function EventImageManager(props: ImageManagerProps) {
  const session = useSession()
  return <ImageManager key={`${props.eventId}:${session.user?.id ?? 'none'}:${session.identityVersion}`} {...props} />
}
function ImageManager({ eventId, disabled = false, ensureEventId, onBusyChange, onUploadSettled, collapsed = false, initialAiOpen = false, onPrepareAi }: ImageManagerProps) {
  const images = useEventCoverState(eventId)
  const session = useSession()
  const client = useQueryClient()
  const [previews, setPreviews] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(!collapsed)
  const [aiOpen, setAiOpen] = useState(initialAiOpen)
  const aiButtonRef = useRef<HTMLButtonElement>(null)
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
  const uploadLabel = flyer ? 'Replace image' : 'Upload image'
  const closeAi = () => { setAiOpen(false); aiButtonRef.current?.focus() }
  return <section className="event-image-manager event-image-manager--compact" aria-label="Event image">
    <header className="event-image-heading"><h2>Event image <span>Optional</span></h2></header>
    <div className="event-image-compact-row">
      <div className="event-flyer-preview">
        {previews.length || flyer ? <img src={previews[0] ?? flyer?.url} alt={previews.length ? 'Uploading image' : 'Event image'} /> : <span>No image yet</span>}
      </div>
      <div className="event-image-compact-controls">
      {!expanded ? <div className="event-image-actions"><button type="button" onClick={() => setExpanded(true)}>Change image</button></div> : <>
    <div className={`event-image-dropzone event-image-dropzone--compact${dragging ? ' event-image-dropzone--active' : ''}`}
      onDragOver={event => { event.preventDefault(); if (!unavailable) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); if (!unavailable) upload(Array.from(event.dataTransfer.files)) }}>
      <label className="event-image-upload">
        <strong>{uploadLabel}</strong>
        <input aria-label={uploadLabel} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={unavailable}
          onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; upload(files) }} />
      </label>
    </div>
    <div className="event-image-actions"><button ref={aiButtonRef} type="button" disabled={unavailable || (!eventId && !onPrepareAi)} aria-expanded={aiOpen} onClick={() => {
      if (aiOpen) { closeAi(); return }
      void run(async current => {
        const preparedId = onPrepareAi ? await onPrepareAi() : eventId
        if (current() && preparedId === eventId) setAiOpen(true)
      })
    }}>Generate with AI</button></div>
    {flyer ? <div className="event-image-actions"><button type="button" disabled={unavailable} onClick={() => void run(async current => removeEventFlyer(eventId, current, revision ?? -1))}>Remove image</button></div> : null}
    </>}
    <p className="event-image-status">JPEG, PNG or WebP · up to 5 MB</p>
    </div></div>
    {!!eventId && images.isPending ? <p role="status">Loading flyer…</p> : null}
    {!!eventId && images.isError ? <p role="alert">Your flyer could not load. <button type="button" onClick={() => void images.refetch()}>Refresh flyer</button></p> : null}
    <p className="event-image-status" aria-live="polite">{busy ? 'Saving image…' : flyer ? 'Image saved.' : 'You can add an image later.'}</p>
    {error ? <p role="alert">{error} {eventId ? <button type="button" disabled={busy} onClick={() => void images.refetch()}>Refresh flyer</button> : null}</p> : null}
    {aiOpen ? <section className="event-image-ai-panel" aria-label="Generate event image">
      <div className="event-image-heading"><h3>Generate an image</h3><button type="button" onClick={closeAi}>Close</button></div>
      <AiCoverChooser eventId={eventId} revision={revision} latestGenerationId={images.data?.latestGenerationId} disabled={unavailable} embedded onSelected={closeAi} />
    </section> : null}
  </section>
}
