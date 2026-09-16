import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
vi.mock('./eventImages.queries', () => ({ useEventImages: () => ({ data: [
  { id: 'secondary', position: 2, url: 'https://example.invalid/secondary.png' },
  { id: 'flyer', position: 1, url: 'https://example.invalid/flyer.png' },
], isError: false }) }))
import { EventImageGallery } from './EventImageGallery'
it('renders only the canonical flyer from legacy attachments regardless of array order', () => {
 render(<EventImageGallery eventId="event" title="Night Market" />)
 expect(screen.getAllByRole('img')).toHaveLength(1)
 expect(screen.getByAltText('Night Market — flyer')).toHaveAttribute('src', 'https://example.invalid/flyer.png')
})
