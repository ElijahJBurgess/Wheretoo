import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { flagDescriptor } from './icon.test-fixtures'
const { list, owned } = vi.hoisted(() => ({ list: vi.fn(), owned: vi.fn() }))
vi.mock('./icon.catalog.api', () => ({ listSelectableMapIcons: list, getOwnedEventMapIcon: owned }))
import { MapIconPicker } from './MapIconPicker'
const catalog = { catalogRevision: 1, selectionEnabled: true, nextCursor: null, icons: [{ ...flagDescriptor, url: '/flag.png' }] }
beforeEach(() => { vi.clearAllMocks(); list.mockResolvedValue(catalog); owned.mockResolvedValue({ versionId: flagDescriptor.versionId, name: 'Wheretoo Flag', state: 'revoked', descriptor: null }) })
function setup(initial: string | null = null) {
  function Form() {
    const [value, setValue] = useState(initial)
    return <><label>Title<input defaultValue="My unsaved event" /></label><MapIconPicker organizerId="owner" eventId="event" value={value} onChange={setValue} /></>
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><Form /></QueryClientProvider>)
  return client
}
it('selects Flag and Default through accessible radios', async () => {
  setup(); const user = userEvent.setup()
  expect(screen.getByRole('radio', { name: 'Default' })).toBeChecked()
  await user.click(await screen.findByRole('radio', { name: 'Wheretoo Flag' }))
  expect(screen.getByRole('radio', { name: 'Wheretoo Flag' })).toBeChecked()
  await user.click(screen.getByRole('radio', { name: 'Default' }))
  expect(screen.getByRole('radio', { name: 'Default' })).toBeChecked()
})
it('keeps the selected value and unrelated text through failure and retry', async () => {
  list.mockRejectedValueOnce(new Error('Offline')); setup(flagDescriptor.versionId)
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: 'Title' }), ' edited')
  await user.click(await screen.findByRole('button', { name: 'Retry map icons' }))
  await waitFor(() => expect(screen.getByRole('radio', { name: 'Wheretoo Flag' })).toBeChecked())
  expect(screen.getByRole('textbox')).toHaveValue('My unsaved event edited')
})
it('does not offer catalog entries when selection is disabled', async () => {
  list.mockResolvedValue({ ...catalog, selectionEnabled: false, icons: [] }); setup()
  await screen.findByText('Default markers are currently available.')
  expect(screen.getAllByRole('radio')).toHaveLength(1)
})
it('retains a revoked current choice but cannot reselect it after Default', async () => {
  list.mockResolvedValue({ ...catalog, icons: [] }); setup(flagDescriptor.versionId)
  const user = userEvent.setup()
  expect(await screen.findByRole('radio', { name: /Wheretoo Flag/ })).toBeDisabled()
  await user.click(screen.getByRole('radio', { name: 'Default' }))
  expect(screen.getByRole('radio', { name: 'Default' })).toBeChecked()
  expect(screen.queryByRole('radio', { name: /Wheretoo Flag/ })).not.toBeInTheDocument()
})

it('supports native radio arrow-key selection', async () => {
  setup(); const user = userEvent.setup()
  await screen.findByRole('radio', { name: 'Wheretoo Flag' })
  screen.getByRole('radio', { name: 'Default' }).focus()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('radio', { name: 'Wheretoo Flag' })).toBeChecked()
  await user.keyboard('{ArrowLeft}')
  expect(screen.getByRole('radio', { name: 'Default' })).toBeChecked()
})

it('retains a choice while the catalog is loading', () => {
  list.mockReturnValue(new Promise(() => {})); setup(flagDescriptor.versionId)
  expect(screen.getByRole('radio', { name: /current choice/ })).toBeChecked()
  expect(screen.getByRole('status')).toHaveTextContent('Loading map icons')
})

it('deduplicates versions across catalog pages', async () => {
  list.mockResolvedValueOnce({ ...catalog, nextCursor: flagDescriptor.versionId }).mockResolvedValue(catalog)
  setup(); const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'More map icons' }))
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  expect(screen.getAllByRole('radio', { name: 'Wheretoo Flag' })).toHaveLength(1)
})

it('does not describe an unsaved choice removed on refresh as saved or retainable', async () => {
  owned.mockResolvedValue({ versionId: null, name: null, state: null, descriptor: null })
  const client = setup(), user = userEvent.setup()
  await user.click(await screen.findByRole('radio', { name: 'Wheretoo Flag' }))
  await user.type(screen.getByRole('textbox'), ' edited')
  list.mockResolvedValue({ ...catalog, icons: [] })
  await act(() => client.invalidateQueries({ queryKey: ['map-icons', 'catalog'] }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Choose Default or another available icon before saving.'))
  expect(screen.getByRole('status')).not.toHaveTextContent('saved choice')
  expect(screen.getByRole('radio', { name: /current choice/ })).toBeChecked()
  expect(screen.getByRole('textbox')).toHaveValue('My unsaved event edited')
})

it('allows keeping an unavailable choice only when it matches the saved assignment', async () => {
  list.mockResolvedValue({ ...catalog, icons: [] }); setup(flagDescriptor.versionId)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('This saved choice'))
  expect(screen.getByRole('status')).toHaveTextContent('You can keep it')
})

it('keeps an unavailable choice when saved-assignment lookup fails and offers retry', async () => {
  list.mockResolvedValue({ ...catalog, icons: [] })
  owned.mockRejectedValueOnce(new Error('Offline'))
  setup(flagDescriptor.versionId)
  const retry = await screen.findByRole('button', { name: 'Retry saved choice' })
  expect(screen.getByRole('status')).toHaveTextContent('couldn’t verify')
  expect(screen.getByRole('status')).not.toHaveTextContent('before saving')
  expect(screen.getByRole('radio', { name: /current choice/ })).toBeChecked()
  await userEvent.setup().click(retry)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('This saved choice'))
})
