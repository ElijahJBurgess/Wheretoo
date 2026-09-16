import { render, screen } from '@testing-library/react'
import { createMemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
        ready: Promise.resolve({ error: null }),
      }),
    },
  },
}))

import { App } from './App'

describe('App', () => {
  it('renders the router supplied by its composition entry', async () => {
    const router = createMemoryRouter([
      { path: '/', Component: () => <h1>Injected ticket shell route</h1> },
    ])

    render(<App router={router} />)

    expect(await screen.findByRole('heading', { name: 'Injected ticket shell route' })).toBeVisible()
  })
})
