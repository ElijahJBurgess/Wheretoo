import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OrganizerTermsPage } from './OrganizerTermsPage'

describe('OrganizerTermsPage', () => {
  it('is visibly a development placeholder with only the approved notice', () => {
    const { container } = render(<OrganizerTermsPage />)

    expect(screen.getByText('Development placeholder')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Whereto Organizer Terms will be finalized before public launch.' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(container).not.toHaveTextContent(/agree|consent|binding|warranty|prohibited/i)
  })
})
