import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { getDevelopmentMapEvents } from './data/developmentMapEvents'
const { query, mounted } = vi.hoisted(() => ({ query: vi.fn(), mounted: vi.fn() }))
const { images } = vi.hoisted(() => ({ images: vi.fn() }))
vi.mock('../features/event-images/publicEventImages', () => ({ usePublicEventImages: images }))
vi.mock('./data/mapEvents.query', () => ({ usePublicMapEvents: query }))
import { Component } from './LivingMapPage'

vi.mock('./core/WheretooMap', () => ({
  WheretooMap: ({ selectedEventId, onSelectEvent, onChooseEvents, onReady, onRendererError }: {
    selectedEventId: string | null
    onSelectEvent(eventId: string | null): void
    onChooseEvents(eventIds: string[], anchor: { longitude: number; latitude: number }): void
    onReady(): void
    onRendererError(error: { code: 'STYLE_LOAD_FAILED'; message: string }): void
  }) => {
    useEffect(() => { mounted() }, [])
    return (
    <div aria-label="map test double" data-selected-event-id={selectedEventId ?? ''}>
      <button onClick={onReady}>ready</button>
      <button onClick={() => onRendererError({ code: 'STYLE_LOAD_FAILED', message: 'The map style could not load.' })}>fail</button>
      <button onClick={() => onSelectEvent('oakland-day-party')}>select day party</button>
      <button onClick={() => onSelectEvent('oakland-vinyl-night')}>select vinyl night</button>
      <button onClick={() => onSelectEvent('event-no-longer-present')}>select missing event</button>
      <button onClick={() => onSelectEvent(null)}>clear selection</button>
      <button onClick={() => onChooseEvents(['oakland-day-party', 'oakland-vinyl-night'], { longitude: -122.259, latitude: 37.807 })}>choose two events</button>
    </div>
  ) },
}))

describe('LivingMapPage', () => {
  beforeEach(() => {
    mounted.mockClear()
    images.mockReturnValue({ data: [] })
    query.mockReturnValue({ events: getDevelopmentMapEvents(), generation: 1, pending: false, error: null, retry: vi.fn() })
  })
  it('loads only the selected public cover, ignores legacy artwork and tolerates revocation without remounting', async () => {
    const cover = 'http://127.0.0.1:64321/functions/v1/event-images?id=11111111-1111-4111-8111-111111111111'
    const view = render(<Component />)
    expect(images).toHaveBeenLastCalledWith([])
    fireEvent.click(await screen.findByRole('button', { name: 'select day party' }))
    expect(images).toHaveBeenLastCalledWith(['oakland-day-party'])
    images.mockReturnValue({ data: [{ eventId: 'oakland-day-party', position: 1, url: cover }] })
    view.rerender(<Component />)
    expect(screen.getByAltText('Day Party artwork')).toHaveAttribute('src', cover)
    images.mockReturnValue({ data: [] })
    view.rerender(<Component />)
    expect(screen.queryByAltText('Day Party artwork')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Event artwork unavailable')).toBeInTheDocument()
    images.mockReturnValue({ data: [{ eventId: 'oakland-day-party', position: 1, url: cover }] })
    fireEvent.click(screen.getByRole('button', { name: 'select vinyl night' }))
    expect(images).toHaveBeenLastCalledWith(['oakland-vinyl-night'])
    expect(screen.queryByAltText('Vinyl Night artwork')).not.toBeInTheDocument()
    expect(mounted).toHaveBeenCalledTimes(1)
  })
  it('defaults to live events and preserves selection through errors without remounting the map', async () => {
    const view = render(<Component />)
    fireEvent.click(await screen.findByRole('button', { name: 'select day party' }))
    expect(screen.getByRole('region', { name: 'Day Party' })).toBeInTheDocument()
    expect(query).toHaveBeenCalledWith(null, null, true)
    query.mockReturnValue({ events: [], generation: 1, pending: false, error: new Error('offline'), retry: vi.fn() })
    view.rerender(<Component />)
    expect(screen.getByRole('region', { name: 'Day Party' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry events' })).toBeInTheDocument()
    query.mockReturnValue({ events: [], generation: 2, pending: false, error: null, retry: vi.fn() })
    view.rerender(<Component />)
    expect(screen.queryByRole('region', { name: 'Day Party' })).not.toBeInTheDocument()
    expect(mounted).toHaveBeenCalledTimes(1)
  })
  it('shows a concise loading state and removes it when the renderer is ready', async () => {
    render(<Component />)
    expect(screen.getByRole('main', { name: 'Explore the Bay Area' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading the map')
    fireEvent.click(await screen.findByRole('button', { name: 'ready' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps an actionable fatal error even if readiness arrives later', async () => {
    render(<Component />)
    fireEvent.click(await screen.findByRole('button', { name: 'fail' }))
    fireEvent.click(screen.getByRole('button', { name: 'ready' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Map unavailable')
    expect(screen.getByRole('alert')).toHaveTextContent('reload this page')
  })

  it('owns event selection in application state and keeps the same selection stable', async () => {
    render(<Component />)
    const map = await screen.findByLabelText('map test double')
    expect(map).toHaveAttribute('data-selected-event-id', '')

    fireEvent.click(screen.getByRole('button', { name: 'select day party' }))
    expect(map).toHaveAttribute('data-selected-event-id', 'oakland-day-party')
    expect(screen.getByRole('region', { name: 'Day Party' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'select day party' }))
    expect(map).toHaveAttribute('data-selected-event-id', 'oakland-day-party')
    fireEvent.click(screen.getByRole('button', { name: 'select vinyl night' }))
    expect(map).toHaveAttribute('data-selected-event-id', 'oakland-vinyl-night')
    expect(screen.queryByRole('region', { name: 'Day Party' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Vinyl Night' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close event preview' }))
    expect(map).toHaveAttribute('data-selected-event-id', '')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('clears an unknown selection without showing stale preview content', async () => {
    render(<Component />)
    const map = await screen.findByLabelText('map test double')
    fireEvent.click(screen.getByRole('button', { name: 'select missing event' }))
    expect(map).toHaveAttribute('data-selected-event-id', '')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('lets Escape dismiss a preview while focus is within the map experience', async () => {
    render(<Component />)
    const map = await screen.findByLabelText('map test double')
    fireEvent.click(screen.getByRole('button', { name: 'select day party' }))
    fireEvent.keyDown(screen.getByRole('region', { name: 'Day Party' }), { key: 'Escape' })
    expect(map).toHaveAttribute('data-selected-event-id', '')
  })

  it('moves from chooser to exact preview and Back restores the chooser', async () => {
    render(<Component />)
    await screen.findByLabelText('map test double')
    fireEvent.click(screen.getByRole('button', { name: 'choose two events' }))
    expect(screen.getByRole('region', { name: '2 events here' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Vinyl Night event preview' }))
    expect(screen.getByRole('region', { name: 'Vinyl Night' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to events' }))
    expect(screen.getByRole('region', { name: '2 events here' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('region', { name: '2 events here' }), { key: 'Escape' })
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})
