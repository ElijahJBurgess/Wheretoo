import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getDevelopmentMapEvents } from '../data/developmentMapEvents'
import { EventChooser } from './EventChooser'
import { sortEventsForChooser } from './eventChooserModel'

describe('EventChooser', () => {
  it('sorts by start time then stable event ID and presents formatted details', () => {
    const [day, vinyl] = getDevelopmentMapEvents()
    const events = sortEventsForChooser([{ ...day, startsAt: vinyl.startsAt, id: 'z-event' }, { ...vinyl, id: 'a-event' }])
    expect(events.map(({ id }) => id)).toEqual(['a-event', 'z-event'])
    render(<EventChooser events={events} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('region', { name: '2 events here' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Vinyl Night event preview' })).toHaveTextContent('From $15')
  })

  it('shows twenty rows initially and Show more makes every member reachable', () => {
    const events = getDevelopmentMapEvents('?mapFixture=dense').slice(0, 25)
    const onVisibleCount = vi.fn()
    const view = render(<EventChooser events={events} onSelect={vi.fn()} onClose={vi.fn()} onVisibleCount={onVisibleCount} />)
    expect(screen.getAllByRole('button', { name: /Open .* event preview/ })).toHaveLength(20)
    fireEvent.click(screen.getByRole('button', { name: 'Show more events' }))
    expect(screen.getAllByRole('button', { name: /Open .* event preview/ })).toHaveLength(25)
    expect(onVisibleCount).toHaveBeenLastCalledWith(25)
    view.unmount()
    render(<EventChooser events={events} initialVisibleCount={25} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /Open .* event preview/ })).toHaveLength(25)
  })

  it('resets pagination when a different chooser replaces the current one', () => {
    const first = getDevelopmentMapEvents('?mapFixture=dense').slice(0, 25)
    const second = first.map((event, index) => ({ ...event, id: `replacement-${index}` }))
    const view = render(<EventChooser events={first} onSelect={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show more events' }))
    expect(screen.getAllByRole('button', { name: /Open .* event preview/ })).toHaveLength(25)

    view.rerender(<EventChooser events={second} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /Open .* event preview/ })).toHaveLength(20)
  })

  it('opens the exact chosen ID and closes with the shared close control', () => {
    const onSelect = vi.fn(); const onClose = vi.fn()
    render(<EventChooser events={getDevelopmentMapEvents().slice(0, 2)} onSelect={onSelect} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Vinyl Night event preview' }))
    expect(onSelect).toHaveBeenCalledWith('oakland-vinyl-night')
    fireEvent.click(screen.getByRole('button', { name: 'Close event chooser' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
