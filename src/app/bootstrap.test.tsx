import { act, screen } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderApplication } from './bootstrap'

describe('application bootstrap', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows progress while application modules load, then renders the application', async () => {
    let resolveApplication!: (application: ReactNode) => void
    const application = new Promise<ReactNode>((resolve) => { resolveApplication = resolve })
    let ready!: Promise<void>

    act(() => { ready = renderApplication(root, application) })

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    await act(async () => {
      resolveApplication(<h1>Application ready</h1>)
      await ready
    })
    expect(screen.getByRole('heading', { name: 'Application ready' })).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('turns a failed module import into an actionable error without exposing its details', async () => {
    await act(async () => {
      await renderApplication(root, Promise.reject(new Error('Internal module configuration detail')))
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Whereto could not load')
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText(/Internal module configuration detail/)).not.toBeInTheDocument()
  })
})
