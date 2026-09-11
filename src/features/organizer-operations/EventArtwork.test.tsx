import { fireEvent, render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { EventArtwork } from './EventArtwork'
it('falls back after an image failure and can render a changed stored URL', () => {
  const view = render(<EventArtwork source='https://example.invalid/event.jpg' className='art' />)
  const image = view.container.querySelector('img')!
  expect(image).toHaveAttribute('src', 'https://example.invalid/event.jpg')
  fireEvent.error(image)
  expect(view.container.querySelector('img')).toBeNull()
  expect(view.container.querySelector('[data-artwork-state=missing]')).not.toBeNull()
  view.rerender(<EventArtwork source='https://example.invalid/new.jpg' className='art' />)
  expect(view.container.querySelector('img')).toHaveAttribute('src', 'https://example.invalid/new.jpg')
})
it('does not render unsupported paths or unsafe URL schemes', () => {
  for (const source of [null, 'bucket/event.jpg', 'javascript:alert(1)', 'http://example.invalid/a']) {
    const view = render(<EventArtwork source={source} className='art' />)
    expect(view.container.querySelector('img')).toBeNull()
    view.unmount()
  }
})
