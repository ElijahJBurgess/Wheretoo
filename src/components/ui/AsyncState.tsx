import type { ReactNode } from 'react'

type AsyncStateProps = {
  action?: ReactNode
  description?: string
  status: 'loading' | 'empty' | 'error'
  title: string
}

export function AsyncState({ action, description, status, title }: AsyncStateProps) {
  const isError = status === 'error'

  return (
    <section
      aria-live={isError ? 'assertive' : 'polite'}
      aria-busy={status === 'loading'}
      className={`ui-async-state ui-async-state--${status}`}
      role={isError ? 'alert' : 'status'}
    >
      {status === 'loading' ? <span aria-hidden="true" className="ui-async-state__spinner" /> : null}
      <p className="ui-async-state__title">{title}</p>
      {description ? <p>{description}</p> : null}
      {action}
    </section>
  )
}
