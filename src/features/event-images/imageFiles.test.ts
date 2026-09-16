import { describe, expect, it } from 'vitest'
import { validateImageSelection } from './imageFiles'

describe('event image selection', () => {
  const image = (type = 'image/png', name = 'photo.png') => new File(['png'], name, { type })
  it('accepts one and three web images', () => {
    expect(() => validateImageSelection([image()], 0)).not.toThrow()
    expect(() => validateImageSelection([image(), image('image/jpeg', 'photo.jpg'), image('image/webp', 'photo.webp')], 0)).not.toThrow()
  })
  it('rejects the fourth image including concurrent saved attachments', () => {
    expect(() => validateImageSelection([image()], 3)).toThrow('three')
    expect(() => validateImageSelection([image(), image()], 2)).toThrow('three')
  })
  it('rejects unsupported or misleading extensions and MIME types', () => {
    for (const file of [image('image/svg+xml', 'x.svg'), image('text/plain'), image('image/png', 'x.html'), image('image/jpeg', 'x.webp')]) {
      expect(() => validateImageSelection([file], 0)).toThrow('JPEG, PNG or WebP')
    }
  })
  it('rejects empty files and files larger than 5 MB', () => {
    expect(() => validateImageSelection([new File([], 'x.png', { type: 'image/png' })], 0)).toThrow('5 MB')
    expect(() => validateImageSelection([new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'x.png', { type: 'image/png' })], 0)).toThrow('5 MB')
  })
})
