import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'

type FieldControlProps = {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'false' | 'true'
}

type FieldProps = {
  children: ReactElement<FieldControlProps>
  error?: string
  label: ReactNode
  name: string
}

export function Field({ children, error, label, name }: FieldProps) {
  if (!isValidElement<FieldControlProps>(children)) {
    return null
  }

  const controlId = children.props.id ?? name
  const errorId = `${name}-error`
  const describedBy = [children.props['aria-describedby'], error ? errorId : undefined]
    .filter(Boolean)
    .join(' ')
  const control = cloneElement(children, {
    id: controlId,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': error ? true : children.props['aria-invalid'],
  })

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={controlId}>
        {label}
      </label>
      {control}
      {error ? (
        <p className="ui-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
