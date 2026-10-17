import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, type ReactElement } from 'react'
import { MemoryRouter, createMemoryRouter, RouterProvider } from 'react-router-dom'
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider> })
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
    useEffect(() => { mounted({ onReady, onRendererError }) }, [onReady, onRendererError])
    return (
    <div aria-label="map test double" data-selected-event-id={selectedEventId ?? ''}>
      <canvas className="mapboxgl-canvas" aria-label="test map canvas" tabIndex={0} />
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
    expect(query).toHaveBeenCalledWith(null, null, true, expect.objectContaining({ discovery: { when: 'next7', category: null, price: null } }))
    query.mockReturnValue({ events: [], generation: 1, pending: false, error: new Error('offline'), retry: vi.fn() })
    view.rerender(<Component />)
    expect(screen.getByRole('region', { name: 'Day Party' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry events' })).toBeInTheDocument()
    query.mockReturnValue({ events: [], generation: 2, pending: false, error: null, retry: vi.fn() })
    view.rerender(<Component />)
    expect(screen.queryByRole('region', { name: 'Day Party' })).not.toBeInTheDocument()
    expect(mounted).toHaveBeenCalledTimes(1)
  })
  afterEach(() => { vi.useRealTimers() })
  it('mounts the renderer under a branded loading status, fades on readiness and never blocks pending events', () => {
    vi.useFakeTimers()
    query.mockReturnValue({ events: [], generation: 0, pending: true, error: null, retry: vi.fn() })
    const view = render(<Component />)
    expect(screen.getByRole('status', { name: 'Loading map' })).toHaveTextContent('Finding your next move.')
    expect(screen.getByLabelText('map test double')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ready' }))
    expect(screen.queryByRole('status', { name: 'Loading map' })).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(180))
    expect(view.container.querySelector('.map-startup')).not.toBeInTheDocument()
    query.mockReturnValue({ events: [], generation: 1, pending: false, error: new Error('offline'), retry: vi.fn() })
    view.rerender(<Component />)
    expect(screen.getByRole('button', { name: 'Retry events' })).toBeInTheDocument()
    expect(view.container.querySelector('.map-startup')).not.toBeInTheDocument()
  })

  it('clears an earlier startup error on successful recovery', () => {
    render(<Component />)
    fireEvent.click(screen.getByRole('button', { name: 'fail' }))
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load the map.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ready' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers a slow-start retry after 15 seconds, clears on late success, and resets on retry', () => {
    vi.useFakeTimers()
    render(<Component />)
    act(() => vi.advanceTimersByTime(14999))
    expect(screen.queryByText('The map is taking longer than expected.')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText('The map is taking longer than expected.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mounted).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('The map is taking longer than expected.')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(15000))
    fireEvent.click(screen.getByRole('button', { name: 'ready' }))
    expect(screen.queryByText('The map is taking longer than expected.')).not.toBeInTheDocument()
    // The separate navigation snapshot debounce also settles without leaving timers.
    act(() => vi.advanceTimersByTime(400))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries a failed map, clears timers on unmount, and uses no fade delay for reduced motion', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const view = render(<Component embedded />)
    fireEvent.click(screen.getByRole('button', { name: 'fail' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mounted).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'ready' }))
    act(() => vi.advanceTimersByTime(0))
    expect(view.container.querySelector('.map-startup')).not.toBeInTheDocument()
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.unstubAllGlobals()
  })

  it('ignores callbacks from the previous attempt after retry', () => {
    render(<Component />)
    const old = mounted.mock.calls[0][0] as { onReady(): void; onRendererError(error: { code: 'STYLE_LOAD_FAILED'; message: string }): void }
    fireEvent.click(screen.getByRole('button', { name: 'fail' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    act(() => { old.onReady(); old.onRendererError({ code: 'STYLE_LOAD_FAILED', message: 'stale' }) })
    expect(screen.getByRole('status', { name: 'Loading map' })).toBeInTheDocument()
    expect(screen.getAllByLabelText('map test double')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'ready' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
    expect(document.querySelector('.living-map__preview-layer')).not.toBeInTheDocument()
  })

  it('clears an unknown selection without showing stale preview content', async () => {
    render(<Component />)
    const map = await screen.findByLabelText('map test double')
    fireEvent.click(screen.getByRole('button', { name: 'select missing event' }))
    expect(map).toHaveAttribute('data-selected-event-id', '')
    expect(document.querySelector('.living-map__preview-layer')).not.toBeInTheDocument()
  })

  it('lets Escape dismiss a preview while focus is within the map experience', async () => {
    render(<Component />)
    const map = await screen.findByLabelText('map test double')
    fireEvent.click(screen.getByRole('button', { name: 'select day party' }))
    fireEvent.keyDown(screen.getByRole('region', { name: 'Day Party' }), { key: 'Escape' })
    expect(map).toHaveAttribute('data-selected-event-id', '')
  })

  it.each(['available', 'expired', 'removed', 'offline'])('restores only a current eligible selection on %s return', async status => {
    const id = '3d000000-0000-4000-8000-000000000001'
    const events = [{ ...getDevelopmentMapEvents()[0], id, endsAt: status === 'expired' ? '2020-01-01T00:00:00Z' : '2027-07-01T00:00:00Z' }]
    query.mockReturnValue({ events: status === 'removed' ? [] : events, complete: status === 'offline' ? null : true, generation: 1, pending: false, error: status === 'offline' ? new Error('offline') : null, retry: vi.fn() })
    const router = createMemoryRouter([{ path: '/map', element: <Component /> }], { initialEntries: [{ pathname: '/map', state: { mapReturn: { version: 1, path: '/map', camera: { center: [-122.264, 37.803], zoom: 16.25, pitch: 25, bearing: 0 }, selectedEventId: id, chooser: null } } }] })
    rtlRender(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
    const map = await screen.findByLabelText('map test double')
    if (status === 'available') expect(map).toHaveAttribute('data-selected-event-id', id)
    else expect(map).toHaveAttribute('data-selected-event-id', '')
  })

  it('does not present a previous-filter selection while its replacement is pending', () => {
    const view = render(<Component />)
    fireEvent.click(screen.getByRole('button', { name: 'select day party' }))
    expect(screen.getByRole('region', { name: 'Day Party' })).toBeInTheDocument()
    query.mockReturnValue({ events: [], generation: 1, pending: true, complete: null, error: null, matchesFilters: false, retry: vi.fn() })
    view.rerender(<Component />)
    expect(screen.queryByRole('region', { name: 'Day Party' })).not.toBeInTheDocument()
  })

  it('shares standalone URL filters without remounting or scrolling when changed', async () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const router = createMemoryRouter([{ path: '/map', element: <Component /> }], { initialEntries: ['/map?when=weekend&category=music&price=paid'] })
    rtlRender(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>)
    fireEvent.change(screen.getByRole('combobox', { name: 'Admission' }), { target: { value: 'free' } })
    expect(router.state.location.search).toBe('?when=weekend&category=music&price=free')
    expect(query).toHaveBeenLastCalledWith(null, null, true, expect.objectContaining({ discovery: { when: 'weekend', category: 'music', price: 'free' } }))
    expect(mounted).toHaveBeenCalledOnce(); expect(scroll).not.toHaveBeenCalled()
    scroll.mockRestore()
  })

  it('offers the bounded chooser to keyboard users and retains focus through preview, Back and Escape', async () => {
    render(<Component />)
    fireEvent.click(screen.getByRole('button', { name: 'ready' }))
    const trigger = screen.getByRole('button', { name: 'Choose an event on the map' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('region', { name: /events here/ })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Open Vinyl Night event preview' }))
    expect(screen.getByRole('region', { name: 'Vinyl Night' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Back to events' }))
    expect(screen.getByRole('button', { name: 'Open Vinyl Night event preview' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(document.querySelector('.living-map__preview-layer')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('returns focus to the map if refreshed inventory disables the chooser trigger', () => {
    const view = render(<Component />)
    fireEvent.click(screen.getByRole('button', { name: 'ready' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose an event on the map' }))
    query.mockReturnValue({ events: [], complete: true, generation: 2, pending: false, error: null, retry: vi.fn() })
    view.rerender(<Component />)
    expect(screen.getByLabelText('test map canvas')).toHaveFocus()
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
    expect(document.querySelector('.living-map__preview-layer')).not.toBeInTheDocument()
  })
})

describe('event result feedback', () => {
  beforeEach(() => { images.mockReturnValue({ data: [] }); mounted.mockClear() })
  it.each([
    { complete: null, events: [], pending: true, text: 'Loading events…' },
    { complete: true, events: [], pending: false, text: 'No events found in this area.' },
    { complete: false, events: getDevelopmentMapEvents(), pending: false, text: 'Some events may be missing. Zoom in to narrow this area.' },
  ])('shows non-blocking feedback: $text', data => {
    query.mockReturnValue({ ...data, generation: 1, error: null, retry: vi.fn() })
    render(<Component />)
    fireEvent.click(screen.getByRole('button', { name: 'ready' }))
    expect(screen.getByText(data.text)).toBeInTheDocument()
    expect(screen.getByLabelText('map test double').closest('[inert]')).toBeNull()
  })
  it('applies expiry cleanup and clears selection even when the refresh has failed', () => {
    const events = getDevelopmentMapEvents()
    query.mockReturnValue({ events, complete: true, generation: 1, pending: false, error: null, retry: vi.fn() })
    const view = render(<Component />)
    fireEvent.click(screen.getByRole('button', { name: 'select day party' }))
    query.mockReturnValue({ events: events.slice(1), complete: true, generation: 2, pending: false, error: new Error('offline'), retry: vi.fn() })
    view.rerender(<Component />)
    expect(screen.queryByRole('region', { name: 'Day Party' })).not.toBeInTheDocument()
    expect(mounted).toHaveBeenCalledTimes(1)
  })
})
