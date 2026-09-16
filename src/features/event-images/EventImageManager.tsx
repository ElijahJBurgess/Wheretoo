import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '../auth/SessionProvider'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { useEventImages } from './eventImages.queries'
import { removeEventImage, reorderEventImages, uploadEventImage } from './eventImages.api'
import { validateImageSelection } from './imageFiles'
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
  const images = useEventImages(eventId ? [eventId] : [])
  const session = useSession()
  const client = useQueryClient()
  const [previews, setPreviews] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const records = images.data ?? []
  const unavailable = disabled || busy || (!!eventId && (images.isPending || images.isError)) || session.status !== 'authenticated'
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (lock.current || unavailable) return
    lock.current = true
    const identityCurrent = captureIdentityLifetime(client, session.user?.id ?? null)
    const current = () => mounted.current && identityCurrent()
    setBusy(true); setError(null); onBusyChange?.(true)
    try { await action(current) } catch (e) { if (current()) setError(e instanceof Error ? e.message : 'Images could not be saved.') }
    finally {
      if (current()) { await client.invalidateQueries({ queryKey: ['event-images'] }); if (current()) { setBusy(false); setPreviews([]); onBusyChange?.(false) } }
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
        validateImageSelection(files, records.length)
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
        for (const file of files) { if (!current()) return; await uploadEventImage(savedId, file, current) }
      } catch (e) {
        failure = e instanceof Error ? e.message : 'Images could not be saved.'
        throw e
      }
    }).then(() => {
      // Finish against the saved draft even if an upload is uncertain. Never
      // make a second draft just because an image response was lost.
      if (savedId && remainsCurrent()) onUploadSettled?.(savedId, failure)
    })
  }
  function move(index: number, direction: number) {
    const ids = records.map(image => image.id)
    ;[ids[index], ids[index + direction]] = [ids[index + direction], ids[index]]
    void run(async () => reorderEventImages(eventId, ids))
  }
  const atLimit = records.length >= 3
  return <section className="event-image-manager" aria-label="Event images">
    <header className="event-image-heading"><h2>Event artwork <span>Optional</span></h2><span>{records.length} / 3</span></header>
    <div className={`event-image-dropzone${dragging ? ' event-image-dropzone--active' : ''}${records.length ? ' event-image-dropzone--compact' : ''}`}
      onDragOver={event => { event.preventDefault(); if (!unavailable && !atLimit) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); if (!unavailable && !atLimit) upload(Array.from(event.dataTransfer.files)) }}>
      <svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><rect x="4" y="6" width="24" height="20" rx="4" stroke="currentColor" strokeWidth="1.5"/><circle cx="11" cy="12" r="2" fill="currentColor"/><path d="m6 23 7-7 4 4 5-6 5 9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
      <label className="event-image-upload">
        <strong>{atLimit ? 'All three images added' : records.length ? 'Add another image' : 'Upload image / flyer'}</strong>
        <input aria-label="Upload images" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple disabled={unavailable || atLimit}
          onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; upload(files) }} />
      </label>
      <p>{atLimit ? 'Remove an image to add a new one.' : 'or drag and drop here'}</p>
      <small>JPEG, PNG or WebP · up to 3 images <span>· 5 MB each</span></small>
    </div>
    {!!eventId && images.isPending ? <p role="status">Loading images…</p> : null}
    {!!eventId && images.isError ? <p role="alert">Images could not load. <button type="button" onClick={() => void images.refetch()}>Refresh images</button></p> : null}
    <p className="event-image-status" aria-live="polite">{busy ? 'Saving images…' : records.length ? 'The first image is primary. Your artwork saves automatically.' : 'Add artwork now, or come back to it later.'}</p>
    {error ? <p role="alert">{error} {eventId ? <button type="button" disabled={busy} onClick={() => void images.refetch()}>Refresh images</button> : null}</p> : null}
    {previews.length ? <div className="event-image-grid" aria-label="Uploading images">{previews.map((url, index) => <div className="event-image-pending" key={index}><img src={url} alt={`Uploading image ${index + 1}`} /><span>Saving…</span></div>)}</div> : null}
    {records.length ? <ol className="event-image-grid">{records.map((image, index) => <li key={image.id}>
      <div className="event-image-thumbnail"><img src={image.url} alt={`Event image ${index + 1}`} /><strong>{index === 0 ? 'Primary image' : `Image ${index + 1}`}</strong></div>
      <div className="event-image-actions">
        <button type="button" disabled={unavailable || index === 0} aria-label={`Move image ${index + 1} earlier`} onClick={() => move(index, -1)}>←</button>
        <button type="button" disabled={unavailable || index === records.length - 1} aria-label={`Move image ${index + 1} later`} onClick={() => move(index, 1)}>→</button>
        <button type="button" disabled={unavailable} aria-label={`Remove image ${index + 1}`} onClick={() => void run(async () => removeEventImage(image.path))}>Remove</button>
      </div>
    </li>)}</ol> : null}
  </section>
}
