import { mutateCover } from './coverTransport'
import { validateImageContent, validateImageSelection } from './imageFiles'

export async function replaceEventFlyer(eventId: string, file: File, current: () => boolean, revision: number): Promise<void> {
  validateImageSelection([file], 0)
  await validateImageContent(file)
  if (!current()) throw new Error('Your session changed. Sign in again before changing your flyer.')
  await mutateCover(eventId, revision, { file }, current)
}

export async function removeEventFlyer(eventId: string, current: () => boolean, revision: number): Promise<void> {
  await mutateCover(eventId, revision, { remove: true }, current)
}
