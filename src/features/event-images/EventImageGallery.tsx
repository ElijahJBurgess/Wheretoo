import { useEventImages } from './eventImages.queries'
import './event-images.css'

export function EventImageGallery({ eventId, title }: { eventId: string; title: string }) {
  const images = useEventImages([eventId])
  if (images.isError) return <p role="status">Your flyer could not load. <button type="button" onClick={() => void images.refetch()}>Retry flyer</button></p>
  const flyer = images.data?.find(image => image.position === 1)
  if (!flyer) return null
  return <div className="event-flyer-preview"><img src={flyer.url} alt={`${title} — flyer`} /></div>
}
