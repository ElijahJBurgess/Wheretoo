import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StartupErrorBoundary } from './StartupErrorBoundary'

function BrokenProvider(): never {
  throw new Error('provider failed with bearer-secret-value')
}

describe('StartupErrorBoundary', () => {
  it('replaces a failed initial React tree with a sanitized shell-free fallback', async () => {
    render(
      <StartupErrorBoundary>
        <BrokenProvider />
      </StartupErrorBoundary>,
    )

    expect(await screen.findByRole('heading', { name: 'Application unavailable' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/auth/sign-in')
    expect(document.body).not.toHaveTextContent('bearer-secret-value')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
