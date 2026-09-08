import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmailPreviewPage } from './EmailPreviewPage'
import { emailPreviewScenarios } from './emailPreviewScenarios'

describe('EmailPreviewPage', () => {
  it.each([
    ['tickets-ready/paid', 'Mission Night Market tickets are ready'],
    ['tickets-ready/free-rsvp', 'Mission Night Market tickets are ready'],
    ['event-cancelled/default', 'Mission Night Market has been cancelled'],
    ['ticket-refunded/default', 'Your Mission Night Market ticket was refunded'],
  ])('renders the fixed %s development preview', async (scenario, expectedCopy) => {
    const input = emailPreviewScenarios[scenario]
    expect(input).toBeDefined()
    if (!input) return

    render(<EmailPreviewPage input={input} />)

    expect(await screen.findByTitle('Email preview')).toHaveAttribute(
      'srcdoc',
      expect.stringContaining(expectedCopy),
    )
    expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument()
  })
})
