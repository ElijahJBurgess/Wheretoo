export type IconImageCallback = (error: Error | null, image?: ImageBitmap | HTMLImageElement | ImageData) => void
export type IconImageRequest = (url: string, callback: IconImageCallback) => () => void

// Mapbox's public loadImage has no cancellation handle. Own the request so a
// timeout releases real network work as well as the controller's loading slot.
export const loadIconImage: IconImageRequest = (url, callback) => {
  const controller = new AbortController()
  let cancelled = false
  void (async () => {
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: controller.signal })
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim() !== 'image/png') throw new Error('Icon PNG unavailable')
    const blob = await response.blob()
    if (blob.size > 1048576) throw new Error('Icon PNG exceeds size limit')
    if (cancelled) return
    const image = await createImageBitmap(blob)
    if (cancelled) image.close()
    else callback(null, image)
  })().catch(error => {
    if (!cancelled) callback(error instanceof Error ? error : new Error('Icon PNG unavailable'))
  })
  return () => { cancelled = true; controller.abort() }
}
