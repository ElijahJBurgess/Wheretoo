import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { evictPrivateIdentityQueries } from '../auth/privateQueryCache'
import { setAuthenticatedIdentity } from '../auth/identityLifetime'
import { uploadImport } from './eventImports.api'
import { EventImportsPage } from './EventImportsPage'

vi.mock('../moderation/staffContext', () => ({
  useStaffContext: () => ({ staffUserId: 'admin-a' }),
}))
vi.mock('./eventImports.queries', () => ({
  useImports: () => ({ isPending: false, isError: false, data: [] }),
}))
vi.mock('./eventImports.api', () => ({
  uploadImport: vi.fn().mockRejectedValue(new Error('Session changed')),
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  sessionStorage.clear()
})

it('does not recreate private upload metadata when sign-out occurs during hashing', async () => {
  const client = new QueryClient()
  setAuthenticatedIdentity(client, 'admin-a')
  let finishHash!: (value: ArrayBuffer) => void
  const digest = vi.fn(() => new Promise<ArrayBuffer>((resolve) => { finishHash = resolve }))
  vi.stubGlobal('crypto', { subtle: { digest }, randomUUID: () => 'request-id' })
  const file = new File(['title\nprivate event'], 'private.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(1) })
  render(<QueryClientProvider client={client}><MemoryRouter><EventImportsPage /></MemoryRouter></QueryClientProvider>)
  fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Upload CSV' })) })
  expect(digest).toHaveBeenCalledOnce()
  evictPrivateIdentityQueries(client)
  setAuthenticatedIdentity(client, null)
  await act(async () => { finishHash(new ArrayBuffer(32)) })
  expect(Object.keys(sessionStorage).filter((key) => key.startsWith('event-import-upload:'))).toEqual([])
  expect(uploadImport).not.toHaveBeenCalled()
  expect(screen.getByRole('heading', { name: 'CSV event imports' })).toBeInTheDocument()
})
