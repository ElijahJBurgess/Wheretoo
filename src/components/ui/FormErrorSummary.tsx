type FormErrorSummaryProps = {
  errors: readonly string[]
  title?: string
}

export function FormErrorSummary({ errors, title = 'Check the highlighted fields' }: FormErrorSummaryProps) {
  if (errors.length === 0) {
    return null
  }

  return (
    <div className="ui-error-summary" role="alert">
      <p className="ui-error-summary__title">{title}</p>
      <ul>
        {errors.map((error, index) => (
          <li key={`${index}-${error}`}>{error}</li>
        ))}
      </ul>
    </div>
  )
}
