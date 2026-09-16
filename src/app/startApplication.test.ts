import { describe, expect, it, vi } from 'vitest'
import { startApplication } from './startApplication'

describe('startApplication', () => {
  it('renders a shell-free sanitized fallback when initial application loading fails', async () => {
    const root = document.createElement('div')
    root.textContent = 'old shell'
    const renderApplication = vi.fn()

    await startApplication(root, async () => {
      throw new Error('import failed with bearer-secret-value')
    }, renderApplication)

    expect(renderApplication).not.toHaveBeenCalled()
    expect(root).toHaveTextContent('Application unavailable')
    expect(root).not.toHaveTextContent('old shell')
    expect(root).not.toHaveTextContent('bearer-secret-value')
    expect(root.querySelector('a')).toHaveAttribute('href', '/auth/sign-in')
    expect(root.querySelector('button')).toBeNull()
  })
})
