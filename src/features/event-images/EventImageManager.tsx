import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '../auth/SessionProvider'
import { captureIdentityLifetime } from '../auth/identityLifetime'
import { useEventImages } from './eventImages.queries'
import { removeEventImage, reorderEventImages, uploadEventImage } from './eventImages.api'
import { validateImageSelection } from './imageFiles'
import './event-images.css'

export function EventImageManager(props: { eventId: string; disabled?: boolean }) {
  const session = useSession()
  return <ImageManager key={`${props.eventId}:${session.user?.id ?? 'none'}:${session.identityVersion}`} {...props} />
}

function ImageManager({ eventId, disabled = false }: { eventId: string; disabled?: boolean }) {
  const images = useEventImages([eventId])
  const session = useSession()
  const client = useQueryClient()
  const [previews, setPreviews] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const records = images.data ?? []
  const unavailable = disabled || busy || images.isPending || images.isError || session.status !== 'authenticated'
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (lock.current || unavailable) return
    lock.current = true
    const current = captureIdentityLifetime(client, session.user?.id ?? null)
    setBusy(true); setError(null)
    try { await action(current) } catch (e) { if (current()) setError(e instanceof Error ? e.message : 'Images could not be saved.') }
    finally {
      if (current()) { await client.invalidateQueries({ queryKey: ['event-images'] }); setBusy(false); setPreviews([]) }
      lock.current = false
    }
  }
  function move(index: number, direction: number) {
    const ids = records.map(image => image.id)
    ;[ids[index], ids[index + direction]] = [ids[index + direction], ids[index]]
    void run(async () => reorderEventImages(eventId, ids))
  }
  return <section className="event-image-manager" aria-label="Event images">
    <h2>Event images <span>(optional)</span></h2>
    <p>Up to 3 JPEG, PNG or WebP images, 5 MB each. The first image is primary. Changes save immediately to this event.</p>
    {images.isPending ? <p role="status">Loading images…</p> : null}
    {images.isError ? <p role="alert">Images could not load. <button type="button" onClick={() => void images.refetch()}>Refresh images</button></p> : null}
    <label className="event-image-upload">Upload images
      <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple disabled={unavailable || records.length >= 3}
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''
          void run(async current => {
            validateImageSelection(files, records.length)
            const pending = await Promise.all(files.map(file => new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result))
              reader.onerror = () => reject(new Error('This image could not be read.'))
              reader.readAsDataURL(file)
            })))
            if (!current()) return
            setPreviews(pending)
            for (const file of files) { if (!current()) return; await uploadEventImage(eventId, file, current) }
          })
        }} />
    </label>
    <p aria-live="polite">{busy ? 'Saving images…' : `${records.length} of 3 images`}</p>
    {error ? <p role="alert">{error} <button type="button" disabled={busy} onClick={() => void images.refetch()}>Refresh images</button></p> : null}
    {previews.length ? <div className="event-image-grid" aria-label="Uploading images">{previews.map((url, index) => <img key={index} src={url} alt={`Uploading image ${index + 1}`} />)}</div> : null}
    <ol className="event-image-grid">{records.map((image, index) => <li key={image.id}>
      <img src={image.url} alt={`Event image ${index + 1}`} />
      <strong>{index === 0 ? 'Primary image' : `Image ${index + 1}`}</strong>
      <div className="event-image-actions">
        <button type="button" disabled={unavailable || index === 0} aria-label={`Move image ${index + 1} earlier`} onClick={() => move(index, -1)}>←</button>
        <button type="button" disabled={unavailable || index === records.length - 1} aria-label={`Move image ${index + 1} later`} onClick={() => move(index, 1)}>→</button>
        <button type="button" disabled={unavailable} aria-label={`Remove image ${index + 1}`} onClick={() => void run(async () => removeEventImage(image.path))}>Remove</button>
      </div>
    </li>)}</ol>
  </section>
}
