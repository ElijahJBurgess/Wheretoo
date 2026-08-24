import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('renders the Whereto organizer entry point', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Create what happens next' })).toBeInTheDocument()
  })
})
