import { listEventImages, removeEventImage, reorderEventImages, uploadEventImage } from './eventImages.api'
import { validateImageContent, validateImageSelection } from './imageFiles'

function requireCurrent(current: () => boolean) {
  if (!current()) throw new Error('Your session changed. Sign in again before changing your flyer.')
}

export async function replaceEventFlyer(eventId: string, file: File, current: () => boolean = () => true): Promise<void> {
  validateImageSelection([file], 0)
  await validateImageContent(file)
  requireCurrent(current)
  const previous = await listEventImages([eventId])
  requireCurrent(current)
  // The legacy backend has three slots. Keep its canonical flyer until the
  // replacement is durable; only a hidden secondary may make room first.
  if (previous.length >= 3) {
    await removeEventImage(previous[previous.length - 1].path)
    requireCurrent(current)
  }
  const path = await uploadEventImage(eventId, file, current)
  requireCurrent(current)
  const saved = await listEventImages([eventId])
  requireCurrent(current)
  const replacement = saved.find(image => image.path === path)
  if (!replacement) throw new Error('Your flyer upload could not be confirmed. Refresh flyer before trying again.')
  if (saved.some(image => image.id !== replacement.id && !previous.some(old => old.id === image.id))) {
    throw new Error('Your flyer changed in another session. Refresh flyer before trying again.')
  }
  await reorderEventImages(eventId, [replacement.id, ...saved.filter(image => image.id !== replacement.id).map(image => image.id)])
  // Reordering checks the complete current set on the server. A conflict leaves
  // the old flyer intact, and no client-side success substitutes for that check.
  for (const image of saved.filter(image => previous.some(old => old.id === image.id))) {
    requireCurrent(current)
    await removeEventImage(image.path)
  }
}

export async function removeEventFlyer(eventId: string, current: () => boolean = () => true): Promise<void> {
  requireCurrent(current)
  const saved = await listEventImages([eventId])
  // Delete hidden legacy attachments first, preventing a secondary from becoming
  // the visible flyer if a removal request fails partway through.
  for (const image of [...saved].reverse()) {
    requireCurrent(current)
    await removeEventImage(image.path)
  }
}
