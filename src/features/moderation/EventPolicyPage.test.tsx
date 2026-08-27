import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EventPolicyPage } from './EventPolicyPage'

describe('EventPolicyPage', () => {
  it('is visibly a development placeholder with only the approved notice', () => {
    const { container } = render(<EventPolicyPage />)

    expect(screen.getByText('Development placeholder')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Whereto Event Policy will be finalized before public launch.' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(container).not.toHaveTextContent(/agree|consent|binding|warranty|prohibited/i)
  })
})
