import type { ReactNode } from 'react'

export type AsyncStatus = 'loading' | 'empty' | 'error' | 'not-found' | 'denied' | 'unavailable' | 'offline'
export type StateSkeleton = 'event-cards' | 'metrics' | 'order-rows' | 'detail-fields'
export type AsyncStateProps = {
  action?: ReactNode
  secondaryAction?: ReactNode
  description?: string
  headingAs?: 'h1' | 'h2' | 'h3'
  skeleton?: StateSkeleton
  status: AsyncStatus
  title: string
}

/** Presentation only. The owning route supplies classifications and explicit actions. */
export function AsyncState({ action, secondaryAction, description, headingAs: Heading = 'h2', skeleton, status, title }: AsyncStateProps) {
  const isError = status === 'error' || status === 'unavailable' || status === 'denied'
  const loading = status === 'loading'
  return (
    <section
      aria-live={isError ? 'assertive' : 'polite'}
      aria-busy={loading}
      className={`ui-async-state ui-async-state--${status}${Heading === 'h1' ? ' ui-async-state--page' : ''}`}
      role={isError ? 'alert' : 'status'}
    >
      {loading ? <span aria-hidden="true" className="ui-async-state__spinner" /> : (
        <svg aria-hidden="true" className="ui-async-state__icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {status === 'empty' ? <><path d="M6 9h20v18H6zM10 5v8m12-8v8M6 15h20" /><path d="M12 21h8" /></>
            : status === 'offline' ? <><path d="M5 12a18 18 0 0 1 22 0M9 17a12 12 0 0 1 14 0m-10 5a5 5 0 0 1 6 0M4 4l24 24" /><circle cx="16" cy="27" r=".5" /></>
              : <><circle cx="16" cy="16" r="12" /><path d="M16 9v9m0 5v.1" /></>}
        </svg>
      )}
      <Heading className="ui-async-state__title">{title}</Heading>
      {description ? <p className="ui-async-state__description">{description}</p> : null}
      {loading && skeleton ? <div aria-hidden="true" className={`ui-state-skeleton ui-state-skeleton--${skeleton}`}>
        {Array.from({ length: skeleton === 'metrics' ? 4 : 3 }, (_, index) => <span key={index}><i /><i /><i /></span>)}
      </div> : null}
      {action || secondaryAction ? <div className="ui-async-state__actions">{action}{secondaryAction}</div> : null}
    </section>
  )
}
