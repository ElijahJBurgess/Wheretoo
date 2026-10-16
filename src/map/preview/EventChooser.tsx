import { forwardRef, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { WheretooMapEvent } from '../data/wheretooMapEvents'
import { formatEventDateTime, formatEventPrice } from './eventPreviewFormatting'
import { sortEventsForChooser } from './eventChooserModel'

type EventChooserProps = {
  events: readonly WheretooMapEvent[]
  initialScrollTop?: number
  initialVisibleCount?: number
  onScrollTop?(scrollTop: number): void
  onVisibleCount?(visibleCount: number): void
  onSelect(eventId: string): void
  onClose(): void
}

export const EventChooser = forwardRef<HTMLElement, EventChooserProps>(function EventChooser(
  { events, initialScrollTop = 0, initialVisibleCount = 20, onScrollTop = () => undefined, onVisibleCount = () => undefined, onSelect, onClose }, ref,
) {
  const titleId = useId()
  const scroll = useRef<HTMLDivElement | null>(null)
  const sorted = useMemo(() => sortEventsForChooser(events), [events])
  const chooserIdentity = useMemo(() => sorted.map(({ id }) => id).join('\u0000'), [sorted])
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount)
  useLayoutEffect(() => setVisibleCount(initialVisibleCount), [chooserIdentity, initialVisibleCount])
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = initialScrollTop }, [initialScrollTop])
  return (
    <section ref={ref} className="event-preview event-chooser" tabIndex={-1} role="region" aria-labelledby={titleId}>
      <div ref={scroll} className="event-preview__scroll event-chooser__scroll" onScroll={(event) => onScrollTop(event.currentTarget.scrollTop)}>
        <div className="event-preview__topline">
          <div><p className="event-preview__eyebrow">wheretoo events</p><h2 id={titleId}>{events.length} {events.length === 1 ? 'event' : 'events'} here</h2></div>
          <button className="event-preview__close" type="button" aria-label="Close event chooser" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
          </button>
        </div>
        <div className="event-chooser__list">
          {sorted.slice(0, visibleCount).map((event) => {
            const schedule = formatEventDateTime(event)
            return (
              <button key={event.id} data-event-id={event.id} className="event-chooser__row" type="button" aria-label={`Open ${event.title} event preview`} onClick={() => onSelect(event.id)}>
                <span className="event-chooser__row-copy"><strong>{event.title}</strong><span>{schedule.date} · {schedule.time}</span><span>{event.venueLabel} · {formatEventPrice(event)}</span></span>
                <span className="event-chooser__chevron" aria-hidden="true">›</span>
              </button>
            )
          })}
        </div>
        {visibleCount < sorted.length ? <button className="event-chooser__more" type="button" aria-label="Show more events" onClick={() => setVisibleCount((count) => { const next = Math.min(count + 20, sorted.length); onVisibleCount(next); return next })}>Show more</button> : null}
      </div>
    </section>
  )
})
