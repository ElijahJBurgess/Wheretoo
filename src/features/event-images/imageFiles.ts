export const MAX_EVENT_IMAGES = 3
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const extensions: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'],
}
export function validateImageSelection(files: readonly File[], existing: number): void {
  if (files.length + existing > MAX_EVENT_IMAGES) throw new Error('An event can have at most three images.')
  for (const file of files) {
    if (!extensions[file.type]?.includes(file.name.split('.').pop()?.toLowerCase() ?? '')) throw new Error('Choose JPEG, PNG or WebP images.')
    if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('Each image must be between 1 byte and 5 MB.')
  }
}
// Decode before sending. MIME/extension alone cannot detect corrupt or renamed files.
export async function validateImageContent(file: File): Promise<void> {
  const image = await createImageBitmap(file).catch(() => { throw new Error('This file is not a readable image.') })
  const valid = image.width > 0 && image.height > 0 && image.width * image.height <= 40_000_000
  image.close()
  if (!valid) throw new Error('Choose an image with at most 40 million pixels.')
}
