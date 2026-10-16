import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { EventPageView } from './EventPageView'
const props = { title: 'Community evening', organizer: 'Local host', date: 'Friday', venue: 'Hall', location: 'Oakland', description: 'A long description '.repeat(80) }
it('keeps its primary action before lengthy copy', () => {
  render(<EventPageView {...props} action={<a href='/tickets'>Get tickets</a>} />)
  expect(screen.getByRole('link', { name: 'Get tickets' }).compareDocumentPosition(screen.getByText(props.description.trim())) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
it('uses the no-artwork layout after image failure and can show a new cover', () => {
  const view = render(<EventPageView {...props} artwork='https://example.invalid/broken.png' />)
  fireEvent.error(screen.getByRole('img'))
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(view.container.querySelector('.buyer-event-hero--no-artwork')).not.toBeNull()
  view.rerender(<EventPageView {...props} artwork='https://example.invalid/new.png' />)
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.invalid/new.png')
})
it('keeps the ticket-selection context compact without repeating the full description', () => {
  render(<EventPageView {...props} selection><p>Ticket controls</p></EventPageView>)
  expect(screen.queryByText(props.description.trim())).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: props.title })).toBeInTheDocument()
})
