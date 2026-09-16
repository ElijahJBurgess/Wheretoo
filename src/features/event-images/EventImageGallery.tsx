import { useEventImages } from './eventImages.queries'
import { usePublicEventImages } from './publicEventImages'
import './event-images.css'
type Props={eventId:string;title:string;includePrimary?:boolean;publicOnly?:boolean}
export function EventImageGallery(props:Props) {
  return props.publicOnly ? <PublicGallery {...props}/> : <OwnerGallery {...props}/>
}
function PublicGallery(props:Props) { return <Gallery {...props} images={usePublicEventImages([props.eventId])}/> }
function OwnerGallery(props:Props) { return <Gallery {...props} images={useEventImages([props.eventId])}/> }
function Gallery({title,includePrimary=true,images}:Props & {images:ReturnType<typeof useEventImages>}) {
  if(images.isError) return <p role="status">Event images could not load. <button type="button" onClick={()=>void images.refetch()}>Retry images</button></p>
  const visible=images.data?.filter(image=>includePrimary||image.position>1)??[]
  if(!visible.length) return null
  return <div className="event-image-gallery" aria-label="Event images">{visible.map((image,index)=><img key={image.id} src={image.url} alt={`${title} — image ${image.position}`} loading={index?'lazy':'eager'}/>)}</div>
}
