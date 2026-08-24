import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AsyncState } from './AsyncState'
import { Button } from './Button'
import { Field } from './Field'
import { FormErrorSummary } from './FormErrorSummary'
import { StepRail } from './StepRail'

describe('organizer UI primitives', () => {
  it('links a field error to its input', () => {
    render(
      <Field label="Event title" name="title" error="Enter a title">
        <input id="title" />
      </Field>,
    )

    expect(screen.getByLabelText('Event title')).toHaveAttribute('aria-describedby', 'title-error')
    expect(screen.getByLabelText('Event title')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a title')
  })

  it('preserves existing child accessibility descriptions', () => {
    render(
      <Field label="Description" name="description" error="Add more detail">
        <textarea aria-describedby="description-hint" />
      </Field>,
    )

    expect(screen.getByLabelText('Description')).toHaveAttribute(
      'aria-describedby',
      'description-hint description-error',
    )
  })

  it('marks the current real workflow step', () => {
    render(<StepRail current={2} labels={['Details', 'Schedule & location', 'Review']} />)

    expect(screen.getByText('Schedule & location')).toHaveAttribute('aria-current', 'step')
  })

  it('renders a semantic button without changing its safe default type', () => {
    render(<Button>Save draft</Button>)

    expect(screen.getByRole('button', { name: 'Save draft' })).toHaveAttribute('type', 'button')
  })

  it('announces form and asynchronous errors', () => {
    const { rerender } = render(<FormErrorSummary errors={['Enter a title', 'Choose a category']} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a title')
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a category')

    rerender(<AsyncState status="error" title="Events could not load" action={<Button>Try again</Button>} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Events could not load')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
