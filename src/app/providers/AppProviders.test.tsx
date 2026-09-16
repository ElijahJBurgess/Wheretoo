import { useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const sdkEvaluation = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase/client', () => { sdkEvaluation(); return { supabase: {} } })

vi.mock('../../features/auth/SessionProvider', () => ({
  SessionProvider: ({ children, queryClient }: PropsWithChildren<{ queryClient?: unknown }>) => (
    <div data-has-query-client={String(Boolean(queryClient))} data-testid="session-provider">
      {children}
    </div>
  ),
}))

import { SessionShell } from '../router/SessionShell'
import { AppProviders } from './AppProviders'

function QueryClientProbe() {
  const queryClient = useQueryClient()
  return <span>{queryClient ? 'Query client ready' : 'Query client missing'}</span>
}

describe('AppProviders', () => {
  it('installs query state without constructing an eager session provider', () => {
    render(
      <AppProviders>
        <QueryClientProbe />
      </AppProviders>,
    )

    expect(screen.getByText('Query client ready')).toBeVisible()
    expect(sdkEvaluation).not.toHaveBeenCalled()
    expect(screen.queryByTestId('session-provider')).not.toBeInTheDocument()
  })

  it('lets the lazy session shell install auth with the existing query client', async () => {
    const router = createMemoryRouter([
      {
        path: '/',
        element: <SessionShell />,
        children: [{ index: true, element: <span>Protected route</span> }],
      },
    ])

    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    )

    expect(await screen.findByText('Protected route')).toBeVisible()
    expect(screen.getByTestId('session-provider')).toHaveAttribute('data-has-query-client', 'true')
  })
})
